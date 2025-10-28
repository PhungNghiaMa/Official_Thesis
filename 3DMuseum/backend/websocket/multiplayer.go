package websocket

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/pion/webrtc/v4"
)

// -----------------------------------------------------------------------------
// SFU / Room / Peer
// -----------------------------------------------------------------------------

type SFU struct {
	rooms map[string]*Room
	mu    sync.RWMutex
	cfg   *webrtc.Configuration
}

type Room struct {
	id    string
	peers map[string]*Peer
	mu    sync.RWMutex
}

type Peer struct {
	id      string
	pc      *webrtc.PeerConnection
	roomRef *Room
	data    *webrtc.DataChannel
	closed  chan struct{}
}

// -----------------------------------------------------------------------------
// Constructor: from typed config
// -----------------------------------------------------------------------------

func NewSFUServer(sfuCfg *SFUConfig) *SFU {
	var iceServers []webrtc.ICEServer

	for _, srv := range sfuCfg.RTC.ICEServers.Servers {
		iceServers = append(iceServers, webrtc.ICEServer{
			URLs:           srv.URLs,
			Username:       srv.Username,
			Credential:     srv.Credential,
			CredentialType: webrtc.ICECredentialTypePassword,
		})
	}

	return &SFU{
		rooms: make(map[string]*Room),
		cfg: &webrtc.Configuration{
			ICEServers: iceServers,
		},
	}
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

func (s *SFU) getOrCreateRoom(roomID string) *Room {
	s.mu.Lock()
	defer s.mu.Unlock()
	room, ok := s.rooms[roomID]
	if ok {
		return room
	}
	room = &Room{
		id:    roomID,
		peers: make(map[string]*Peer),
	}
	s.rooms[roomID] = room
	return room
}

func (r *Room) addPeer(p *Peer) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.peers[p.id] = p
	log.Printf("[room %s] peer %s joined (total %d)", r.id, p.id, len(r.peers))
}

func (r *Room) removePeer(id string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if p, ok := r.peers[id]; ok {
		delete(r.peers, id)
		close(p.closed)
		log.Printf("[room %s] peer %s removed (remaining %d)", r.id, id, len(r.peers))
	}
}

// -----------------------------------------------------------------------------
// WebRTC setup
// -----------------------------------------------------------------------------

func createPeerConnection(cfg *webrtc.Configuration) (*webrtc.PeerConnection, error) {
	pc, err := webrtc.NewPeerConnection(*cfg)
	if err != nil {
		return nil, err
	}
	pc.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		log.Printf("[pc] conn state: %s", state.String())
	})
	return pc, nil
}

// -----------------------------------------------------------------------------
// HandleJoin: used by Gin route
// -----------------------------------------------------------------------------

func BindOfferFromContext(c *gin.Context) (webrtc.SessionDescription, error) {
	var offer webrtc.SessionDescription
	if c.Request.Body == nil {
		return offer, errors.New("missing body")
	}
	dec := json.NewDecoder(c.Request.Body)
	if err := dec.Decode(&offer); err != nil {
		return offer, err
	}
	return offer, nil
}

func (s *SFU) HandleJoin(c *gin.Context) {
	roomID := c.Query("room")
	peerID := c.Query("peer")
	if roomID == "" || peerID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "room and peer query params required"})
		return
	}

	offer, err := BindOfferFromContext(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid offer: " + err.Error()})
		return
	}

	pc, err := createPeerConnection(s.cfg)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "pc create: " + err.Error()})
		return
	}

	room := s.getOrCreateRoom(roomID)
	peer := &Peer{
		id:      peerID,
		pc:      pc,
		roomRef: room,
		closed:  make(chan struct{}),
	}
	room.addPeer(peer)

	pc.OnDataChannel(func(dc *webrtc.DataChannel) {
		log.Printf("[peer %s] datachannel open: %s"   , peerID, dc.Label())
		peer.data = dc
		dc.OnMessage(func(msg webrtc.DataChannelMessage) {
			room.broadcastData(peerID, msg.Data)
		})
	})

	pc.OnTrack(func(remote *webrtc.TrackRemote, recv *webrtc.RTPReceiver) {
		log.Printf("[room %s] track %s from %s codec=%s", room.id, remote.ID(), peerID, remote.Codec().MimeType)
		room.forwardTrack(peerID, remote)
	})

	pc.OnICECandidate(func(cand *webrtc.ICECandidate) {
		if cand != nil {
			log.Printf("[peer %s] ICE candidate: %s", peerID, cand.ToJSON().Candidate)
		}
	})

	if err := pc.SetRemoteDescription(offer); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		room.removePeer(peerID)
		_ = pc.Close()
		return
	}

	answer, err := pc.CreateAnswer(nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		room.removePeer(peerID)
		_ = pc.Close()
		return
	}
	// _ = pc.SetLocalDescription(answer)

	if err := pc.SetLocalDescription(answer); err != nil {
		log.Printf("SetLocalDescription error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		room.removePeer(peerID)
		_ = pc.Close()
		return
	}

	// Wait for ICE gathering to finish (or timeout)
	gatherDone := webrtc.GatheringCompletePromise(pc)
	select {
	case <-gatherDone:
		// gathered, return full local description
	case <-time.After(3 * time.Second):
		// timeout — still return what we have but log
		log.Printf("[room %s] ICE gathering timeout for peer %s", room.id, peerID)
	}

	ld := pc.LocalDescription()
	if ld == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "local description is nil"})
		room.removePeer(peerID)
		_ = pc.Close()
		return
	}
	c.JSON(http.StatusOK, ld)
}

// -----------------------------------------------------------------------------
// Broadcasting and Forwarding
// -----------------------------------------------------------------------------

func (r *Room) broadcastData(senderID string, data []byte) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for id, p := range r.peers {
		if id == senderID || p.data == nil {
			continue
		}
		_ = p.data.Send(data)
	}
}

func (r *Room) forwardTrack(senderID string, remote *webrtc.TrackRemote) {
	r.mu.RLock()
	peers := make([]*Peer, 0, len(r.peers))
	for _, p := range r.peers {
		peers = append(peers, p)
	}
	r.mu.RUnlock()

	for _, p := range peers {
		if p.id == senderID || p.pc == nil {
			continue
		}
		codec := remote.Codec()
		rtpCap := webrtc.RTPCodecCapability{
			MimeType:  codec.MimeType,
			ClockRate: codec.ClockRate,
			Channels:  codec.Channels,
		}

		localTrack, err := webrtc.NewTrackLocalStaticRTP(rtpCap, remote.ID(), "relay")
		if err != nil {
			continue
		}

		sender, err := p.pc.AddTrack(localTrack)
		if err != nil {
			continue
		}

		go func() {
			defer func() { _ = sender.Stop() }()
			buf := make([]byte, 1500)
			for {
				n, _, err := remote.Read(buf)
				if err != nil {
					return
				}
				if _, err = localTrack.Write(buf[:n]); err != nil {
					return
				}
			}
		}()
	}
}

// -----------------------------------------------------------------------------
// Shutdown
// -----------------------------------------------------------------------------

func (s *SFU) CloseAll() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, r := range s.rooms {
		r.mu.RLock()
		for _, p := range r.peers {
			if p.pc != nil {
				_ = p.pc.Close()
			}
		}
		r.mu.RUnlock()
	}
	s.rooms = make(map[string]*Room)
}
