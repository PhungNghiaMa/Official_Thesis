package websocket

// A compact single-file relay-style SFU using pion/webrtc.
// - Exported: NewSFUServer, (s *SFU) HandleJoin
// - Configurable STUN/TURN via env vars (STUN_URLS, TURN_URL, TURN_USER, TURN_PASS).
// - Uses HTTP POST body for offer (JSON) and returns answer JSON.
// - For each incoming TrackRemote, creates TrackLocal on each other peer and forwards RTP bytes.
// - Handles DataChannel broadcast for small game state messages.
// - Performs RTCP pumping to keep RTP flows alive.

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/pion/webrtc/v4"
)

// -----------------------------------------------------------------------------
// SFU / Room / Peer types
// -----------------------------------------------------------------------------

type SFU struct {
	rooms map[string]*Room
	mu    sync.RWMutex
	// optional: global webrtc API / engine config could be added here
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
// Constructor
// -----------------------------------------------------------------------------

func NewSFUServer() *SFU {
	return &SFU{
		rooms: make(map[string]*Room),
	}
}

// -----------------------------------------------------------------------------
// Helpers: Room lifecycle
// -----------------------------------------------------------------------------

func (s *SFU) getOrCreateRoom(roomID string) *Room {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.rooms[roomID]
	if ok {
		return r
	}
	r = &Room{
		id:    roomID,
		peers: make(map[string]*Peer),
	}
	s.rooms[roomID] = r
	return r
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
// Config: STUN / TURN from env (simple)
// -----------------------------------------------------------------------------

// STUN_URLS env example: "stun:stun.l.google.com:19302,stun:1.2.3.4:3478"
// TURN_URL env example: "turn:turn.example.com:3478"
// TURN_USER / TURN_PASS for credentials
func getWebRTCConfigFromEnv() webrtc.Configuration {
	cfg := webrtc.Configuration{}

	stunEnv := os.Getenv("STUN_URLS")
	if stunEnv == "" {
		stunEnv = "stun:stun.l.google.com:19302"
	}
	for _, u := range strings.Split(stunEnv, ",") {
		u = strings.TrimSpace(u)
		if u != "" {
			cfg.ICEServers = append(cfg.ICEServers, webrtc.ICEServer{URLs: []string{u}})
		}
	}

	turnURL := os.Getenv("TURN_URL")
	turnUser := os.Getenv("TURN_USER")
	turnPass := os.Getenv("TURN_PASS")
	if turnURL != "" && turnUser != "" && turnPass != "" {
		cfg.ICEServers = append(cfg.ICEServers, webrtc.ICEServer{
			URLs:       []string{turnURL},
			Username:   turnUser,
			Credential: turnPass,
		})
	}
	return cfg
}

// -----------------------------------------------------------------------------
// Create a new PeerConnection with sane defaults
// -----------------------------------------------------------------------------

func createPeerConnection(cfg webrtc.Configuration) (*webrtc.PeerConnection, error) {
	// MediaEngine default codecs (pion auto-registers common codecs).
	// You could fine-tune codecs here if needed.
	// Using default API for simplicity:
	pc, err := webrtc.NewPeerConnection(cfg)
	if err != nil {
		return nil, err
	}
	// Setup simple handlers for debugging
	pc.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		log.Printf("[pc] conn state: %s", state.String())
	})
	return pc, nil
}

// -----------------------------------------------------------------------------
// Handler: join (expect JSON offer in body). Returns JSON answer.
// This method is intended to be registered on a Gin route, e.g. POST /sfu/join
// -----------------------------------------------------------------------------

// BindOffer is a helper so we accept both application/json and raw body with JSON.
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

// HandleJoinGin wires a peer into the given room. Must be registered with Gin.
// Query params: ?room=<roomid>&peer=<peerid>
// Body: JSON SDP offer (webrtc.SessionDescription)
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

	// create PC
	cfg := getWebRTCConfigFromEnv()
	pc, err := createPeerConnection(cfg)
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

	// Datachannel creation: either client creates it, or server can create one.
	pc.OnDataChannel(func(dc *webrtc.DataChannel) {
		log.Printf("[peer %s] datachannel open: %s", peerID, dc.Label())
		peer.data = dc
		dc.OnMessage(func(msg webrtc.DataChannelMessage) {
			// Broadcast small messages to other peers
			room.broadcastData(peerID, msg.Data)
		})
	})

	// Handle track forwarding (incoming media)
	pc.OnTrack(func(remote *webrtc.TrackRemote, recv *webrtc.RTPReceiver) {
		log.Printf("[room %s] incoming track %s from %s codec=%s", room.id, remote.ID(), peerID, remote.Codec().MimeType)
		room.forwardTrack(peerID, remote)
	})

	// ICE candidate callback for trickle ICE logging
	pc.OnICECandidate(func(cand *webrtc.ICECandidate) {
		if cand == nil {
			return
		}
		// For a production signaling protocol you would forward these candidates to the client.
		log.Printf("[peer %s] ICE candidate: %s", peerID, cand.ToJSON().Candidate)
	})

	// Set remote description (offer)
	if err := pc.SetRemoteDescription(offer); err != nil {
		log.Printf("SetRemoteDescription error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		room.removePeer(peerID)
		_ = pc.Close()
		return
	}

	// Create answer
	answer, err := pc.CreateAnswer(nil)
	if err != nil {
		log.Printf("CreateAnswer error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		room.removePeer(peerID)
		_ = pc.Close()
		return
	}

	// Gather ICE (optional: you may want to wait for ICE gathering; here we return immediately and rely on trickle)
	if err := pc.SetLocalDescription(answer); err != nil {
		log.Printf("SetLocalDescription error: %v", err)
	}

	// Return the local description (answer) to the caller
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
// Room forwarding & data broadcast logic
// -----------------------------------------------------------------------------

// broadcastData sends data to all datachannels except sender
func (r *Room) broadcastData(senderID string, data []byte) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for id, p := range r.peers {
		if id == senderID || p == nil || p.data == nil {
			continue
		}
		// best-effort send
		_ = p.data.Send(data)
	}
}

// forwardTrack forwards an incoming TrackRemote to all other peers by creating a TrackLocalStaticRTP and feeding RTP bytes.
// This keeps the packet stream intact (simple relay).
func (r *Room) forwardTrack(senderID string, remote *webrtc.TrackRemote) {
	r.mu.RLock()
	peersSnapshot := make([]*Peer, 0, len(r.peers))
	for _, p := range r.peers {
		peersSnapshot = append(peersSnapshot, p)
	}
	r.mu.RUnlock()

	// For each peer != sender create a TrackLocal and pump the bytes
	for _, p := range peersSnapshot {
		// skip original sender
		if p.id == senderID {
			continue
		}
		// ensure pc still valid
		if p.pc == nil {
			continue
		}

		// create local track using remote's codec
		codec := remote.Codec()
		rtpCap := webrtc.RTPCodecCapability{
			MimeType:  codec.MimeType,
			ClockRate: codec.ClockRate,
			Channels:  codec.Channels,
			// Note: you can include SDPParameters if needed
		}

		localTrack, err := webrtc.NewTrackLocalStaticRTP(rtpCap, remote.ID(), "sfu")
		if err != nil {
			log.Printf("[room %s] NewTrackLocalStaticRTP error for peer %s: %v", r.id, p.id, err)
			continue
		}

		sender, err := p.pc.AddTrack(localTrack)
		if err != nil {
			log.Printf("[room %s] AddTrack error for peer %s: %v", r.id, p.id, err)
			continue
		}

		// pump remote -> local
		go func(remoteTrack *webrtc.TrackRemote, local *webrtc.TrackLocalStaticRTP, dstPeer *Peer, dstSender *webrtc.RTPSender) {
			defer func() {
				// best-effort: Close local track or let GC handle when pc closes
				log.Printf("[room %s] stop forwarding %s -> %s", r.id, remoteTrack.ID(), dstPeer.id)
			}()

			buf := make([]byte, 1500)
			for {
				n, _, readErr := remoteTrack.Read(buf)
				if readErr != nil {
					if readErr == io.EOF {
						return
					}
					log.Printf("[room %s] remote read error from %s: %v", r.id, remoteTrack.ID(), readErr)
					return
				}

				// Try to parse rtp packet to preserve headers if necessary (optional)
				// But NewTrackLocalStaticRTP.Write expects raw RTP payload bytes as rtp.Packet serialization.
				// We'll write raw packet bytes.
				if _, werr := local.Write(buf[:n]); werr != nil {
					log.Printf("[room %s] forward write error to %s: %v", r.id, dstPeer.id, werr)
					return
				}
			}
		}(remote, localTrack, p, sender)

		// read RTCP from the sender to satisfy pion's requirement
		go func(snd *webrtc.RTPSender) {
			rtcpBuf := make([]byte, 1500)
			for {
				if _, _, err := snd.Read(rtcpBuf); err != nil {
					// sender closed or peer disconnected
					return
				}
			}
		}(sender)
	}
}

// -----------------------------------------------------------------------------
// Utility: Close room and all peer connections (call during graceful shutdown)
// -----------------------------------------------------------------------------

func (s *SFU) CloseRoom(roomID string) {
	s.mu.Lock()
	room, ok := s.rooms[roomID]
	if ok {
		delete(s.rooms, roomID)
	}
	s.mu.Unlock()
	if ok {
		room.mu.RLock()
		for _, p := range room.peers {
			if p.pc != nil {
				_ = p.pc.Close()
			}
		}
		room.mu.RUnlock()
	}
}

// CloseAll shuts down all rooms/peers
func (s *SFU) CloseAll() {
	s.mu.Lock()
	rooms := s.rooms
	s.rooms = make(map[string]*Room)
	s.mu.Unlock()

	for _, r := range rooms {
		r.mu.RLock()
		for _, p := range r.peers {
			if p.pc != nil {
				_ = p.pc.Close()
			}
		}
		r.mu.RUnlock()
	}
}

// -----------------------------------------------------------------------------
// Convenience: Register Gin routes helper
// -----------------------------------------------------------------------------
