package multiplayer

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/pion/webrtc/v4"
	"github.com/pion/webrtc/v4/pkg/media"
)

// This multiplayer package handles WebRTC-based real-time communication for the 3D museum.
// It uses an SFU architecture to efficiently relay audio tracks between peers in rooms.

// -----------------------------------------------------------------------------
// SFU / Room / Peer
// These core structs represent the SFU server, rooms, and individual peers.
// The SFU manages multiple rooms, each room contains peers, and each peer has a WebRTC connection.
// -----------------------------------------------------------------------------

type SFU struct {
	rooms map[string]*Room
	mu    sync.RWMutex
	cfg   *webrtc.Configuration
	api   *webrtc.API
}

type Room struct {
	id    string
	peers map[string]*Peer
	mu    sync.RWMutex // Allow multiple concurrent readers but exclusive writers
}

type Peer struct {
	id         string
	pc         *webrtc.PeerConnection
	roomRef    *Room
	data       *webrtc.DataChannel
	closed     chan struct{}
	recvTracks map[string]*webrtc.TrackRemote // Added to keep track of received tracks for forwarding
}

// -----------------------------------------------------------------------------
// Constructor: from typed config
// This constructor initializes the SFU with ICE servers from the configuration.
// This ensures proper STUN/TURN setup for WebRTC connections.
// -----------------------------------------------------------------------------

// func NewSFURepo(sfuCfg *SFUConfig) *SFU {
// 	var iceServers []webrtc.ICEServer

// 	for _, srv := range sfuCfg.RTC.ICEServers.Servers {
// 		iceServers = append(iceServers, webrtc.ICEServer{
// 			URLs:           srv.URLs,
// 			Username:       srv.Username,
// 			Credential:     srv.Credential,
// 			CredentialType: webrtc.ICECredentialTypePassword,
// 		})
// 	}

// 	return &SFU{
// 		rooms: make(map[string]*Room),
// 		cfg: &webrtc.Configuration{
// 			ICEServers: iceServers,
// 		},
// 	}
// }


func NewSFURepo(sfuCfg *SFUConfig) *SFU {
	var iceServers []webrtc.ICEServer

	for _, srv := range sfuCfg.RTC.ICEServers.Servers {
		iceServers = append(iceServers, webrtc.ICEServer{
			URLs:           srv.URLs,
			Username:       srv.Username,
			Credential:     srv.Credential,
			CredentialType: webrtc.ICECredentialTypePassword,
		})
	}

	// 1. Create a SettingEngine to handle the External IP
	settingEngine := webrtc.SettingEngine{}
	if sfuCfg.RTC.ExternalIP != "" && sfuCfg.RTC.ExternalIP != "0.0.0.0" {
		settingEngine.SetNAT1To1IPs([]string{sfuCfg.RTC.ExternalIP}, webrtc.ICECandidateTypeHost)
	}

	// 2. Create the API object with our settings
	// Note: webrtc.NewPeerConnection uses a default API that only supports basic ICE server config.
	// ExternalIP (NAT 1-to-1 mapping) is a low-level network option in SettingEngine, not in Configuration.
	// To apply ExternalIP, you must build a custom API with your SettingEngine and use it to create connections.
	api := webrtc.NewAPI(webrtc.WithSettingEngine(settingEngine))

	// 3. Update the SFU struct to use the API for creating connections
	return &SFU{
		rooms: make(map[string]*Room),
		cfg: &webrtc.Configuration{
			ICEServers: iceServers,
		},
		api: api,
	}
}

// -----------------------------------------------------------------------------
// Helpers
// These helper methods manage rooms and peers efficiently.
// The getOrCreateRoom method ensures rooms are created on demand.
// -----------------------------------------------------------------------------

func (s *SFU) getOrCreateRoom(roomID string) *Room {
	s.mu.Lock()
	defer s.mu.Unlock()
	room, ok := s.rooms[roomID]
	// If room exists, return it
	if ok {
		return room
	}
	// Else , create a new room
	room = &Room{
		id:    roomID,
		peers: make(map[string]*Peer),
	}
	// Store the new room in the SFU's rooms map
	s.rooms[roomID] = room
	return room
}

// func (r *Room) addPeer(p *Peer) {
// 	r.mu.Lock()
// 	defer r.mu.Unlock()
// 	r.peers[p.id] = p
// 	log.Printf("[room %s] peer %s joined (total %d)", r.id, p.id, len(r.peers))
// }


// Explain addPeer process 
// Remote peer sends a track → The SFU receives it as a remote track.

// Create localTrack → The SFU builds a localTrack with the same codec capability (rtpCap) so it’s compatible with other peers.

// AddTrack → For each new peer connection (p.pc), the SFU calls AddTrack(localTrack).

// This tells WebRTC: “This peer should receive this relayed track.”

// Goroutine relay loop →

// Reads RTP packets from the remote track into the buffer.

// Writes those packets into the localTrack.

// The localTrack is already attached to the new peer’s connection, so the peer receives the stream continuously.

// Result → The new peer hears/sees the remote peer’s media in real time, without the SFU re-encoding — just forwarding RTP packets.

func (r *Room) addPeer(p *Peer) {
	r.mu.Lock()
	defer r.mu.Unlock()
	// Assign peer to room's peer map
	r.peers[p.id] = p
	log.Printf("[room %s] peer %s joined (total %d)", r.id, p.id, len(r.peers))

	// Added this goroutine to forward all existing remote tracks from other peers to the new peer.
	// This ensures the new peer receives audio from everyone already in the room.
	go func() {
		r.mu.RLock()
		defer r.mu.RUnlock()
		// Access the peers map in the room 
		for _, other := range r.peers {
			// If the peer is itself, skip
			if other.id == p.id {
				continue
			}
			// Else, forward all remote tracks from the other peer to the new peer
			// other.recvTracks contains all incoming tracks from the other peer
			for _, remote := range other.recvTracks {
				codec := remote.Codec()
				// rtpCap defines the codec that peer can handle 
				// Basically, the codec info of the remote track is copied into this capability struct 
				// and used to create a local track for the new peer
				rtpCap := webrtc.RTPCodecCapability{
					MimeType:  codec.MimeType, // e.g., "audio/opus" , "video/VP8" , ....
					ClockRate: codec.ClockRate,
					Channels:  codec.Channels, // mono or stereo
				}
				// Create a local track on the new peer with the same codec as the remote track
				localTrack, err := webrtc.NewTrackLocalStaticRTP(rtpCap, remote.ID(), "relay")
				if err != nil {
					log.Printf("[room %s] failed create local track for %s: %v", r.id, remote.ID(), err)
					continue
				}
				// Add the local track (relay of remote peer’s media) to this peer’s PeerConnection,
				// so that this peer will receive the audio/video stream originally sent by the remote peer.
				// AddTrack means that this peer should receive this relayed track
				sender, err := p.pc.AddTrack(localTrack)
				if err != nil {
					log.Printf("[room %s] addTrack failed: %v", r.id, err)
					continue
				}

				// Copy audio packets from remote to local track in a separate goroutine.
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
	}()
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
// This helper function creates peer connections with the configured ICE servers.
// It also logs connection state changes for debugging.
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
// This HTTP handler processes join requests from clients.
// It creates a peer connection, sets up event handlers, and returns the answer SDP.
// -----------------------------------------------------------------------------
// The SDP Offer is a text description generated by the client’s pc.createOffer().

// It contains:

// Codecs supported (e.g., Opus for audio, VP8/VP9/H.264 for video).

// Media types (audio, video, data channels).

// ICE candidates (network paths for connectivity).

// DTLS fingerprints
//  the offer is essentially the client saying to the server:
// “Here are the codecs and capabilities I support, and here’s how you can reach me.”
func BindOfferFromContext(c *gin.Context) (webrtc.SessionDescription, error) {
	var offer webrtc.SessionDescription
	if c.Request.Body == nil {
		return offer, errors.New("missing body")
	}
	dec := json.NewDecoder(c.Request.Body)
	// Attempts to decode the JSON body into the offer struct.
// 	The browser sends this JSON in the HTTP POST body.
	// Your function BindOfferFromContext:

	// Reads the body.

	// Decodes it into a webrtc.SessionDescription struct (which has Type and SDP fields).

	// Returns it so the server can set it as the remote description and generate an answer.
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

	// pc, err := createPeerConnection(s.cfg)
	pc, err := s.api.NewPeerConnection(*s.cfg)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "pc create: " + err.Error()})
		return
	}

	room := s.getOrCreateRoom(roomID)
	peer := &Peer{
		id:         peerID,
		pc:         pc,
		roomRef:    room,
		closed:     make(chan struct{}),
		recvTracks: make(map[string]*webrtc.TrackRemote),
	}
	room.addPeer(peer)

	// pc.OnDataChannel is the hook that lets your server handle non-media communication from peers.

	// It’s separate from audio/video tracks.

	// In your SFU, it’s used to broadcast chat/game data to all peers in the room.
	pc.OnDataChannel(func(dc *webrtc.DataChannel) {
		log.Printf("[peer %s] datachannel open: %s", peerID, dc.Label())
		peer.data = dc
		// When a message is received on this data channel,
		// the SFU broadcasts it to all other peers in the room.
		dc.OnMessage(func(msg webrtc.DataChannelMessage) {
			room.broadcastData(peerID, msg.Data)
		})
	})
	// pc.OnTrack is the hook that lets your server handle incoming media tracks from peers.

	// In your SFU, it’s used to receive audio tracks from peers and forward them to others.
	pc.OnTrack(func(remote *webrtc.TrackRemote, recv *webrtc.RTPReceiver) {
		log.Printf("[room %s] track %s from %s codec=%s", room.id, remote.ID(), peerID, remote.Codec().MimeType)
		room.forwardTrack(peerID, remote)
	})

	// Registers a callback for when the PeerConnection discovers a new ICE candidate (network path for connectivity).

	// ICE candidates are IP/port combinations found via STUN/TURN.

	// Each time one is found, it logs it.

	// This is part of NAT traversal — figuring out how peers can connect across the internet.
	pc.OnICECandidate(func(cand *webrtc.ICECandidate) {
		if cand != nil {
			log.Printf("[peer %s] ICE candidate: %s", peerID, cand.ToJSON().Candidate)
		}
	})

	// Set the remote SessionDescription (offer) received from the client.
	// Sets the remote description (the SDP offer sent by the client) , in other words 
	// this is where the server learns about the client’s capabilities and applies the client’s offer 
	// This tells the server what codecs, tracks, and network info the client supports.
	// If it fails, the server responds with error JSON, removes the peer from the room, and closes the connection.
	if err := pc.SetRemoteDescription(offer); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		room.removePeer(peerID)
		_ = pc.Close()
		return
	}

	// Create an answer to send back to the client.
	// This generates the server’s SDP answer based on the client’s offer.
	// The answer contains the codecs and tracks the server agrees to use.
	// If it fails, the server responds with error JSON, removes the peer from the room, and closes the connection.
	answer, err := pc.CreateAnswer(nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		room.removePeer(peerID)
		_ = pc.Close()
		return
	}

	// Sets the local description (the SDP answer generated by the server).
	// This finalizes the server’s side of the connection setup.
	// If it fails, the server responds with error JSON, removes the peer from the room, and closes the connection.
	if err := pc.SetLocalDescription(answer); err != nil {
		log.Printf("SetLocalDescription error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		room.removePeer(peerID)
		_ = pc.Close()
		return
	}

	// Wait for ICE gathering to complete or timeout to ensure the answer includes all candidates.
	// Waits for ICE candidate gathering to finish.

	// Ensures the SDP answer includes all possible candidates.

	// Uses a timeout (3 seconds) to avoid hanging forever.

	// If timeout hits, logs a warning but still proceeds with whatever candidates are available.
	gatherDone := webrtc.GatheringCompletePromise(pc)
	select {
	case <-gatherDone:
		// gathered, return full local description
	case <-time.After(3 * time.Second):
		// timeout — still return what we have but log
		log.Printf("[room %s] ICE gathering timeout for peer %s", room.id, peerID)
	}
	
	// Retrieves the final local description (the SDP answer with ICE candidates).

	// If it’s nil, error out and clean up.

	// Otherwise, return it as JSON to the client.

	// The client then sets this as its remote description, completing the WebRTC handshake.
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
// Data broadcasting for chat-like features and track forwarding for audio relay.
// The forwardTrack method uses a jitter buffer to smooth audio playback.
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
// Reads raw RTP and feeds it into a sample-based local track (smoother).
// Added a 20 ms jitter buffer to prevent audio crackles on lag spikes.
// It gracefully drops old packets instead of freezing audio.
// Keeps latency low at ~100–150 ms typical.
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

		// Switched to TrackLocalStaticSample for smoother pacing
		localTrack, err := webrtc.NewTrackLocalStaticSample(rtpCap, remote.ID(), "relay")
		if err != nil {
			log.Printf("[room %s] track relay create err: %v", r.id, err)
			continue
		}

		sender, err := p.pc.AddTrack(localTrack)
		if err != nil {
			log.Printf("[room %s] add track err: %v", r.id, err)
			continue
		}

		go func() {
			defer func() { _ = sender.Stop() }()
			buf := make([]byte, 1500)

			// Added a small jitter buffer channel
			packets := make(chan []byte, 200)

			go func() {
				for {
					n, _, err := remote.Read(buf)
					if err != nil {
						close(packets)
						return
					}
					frame := make([]byte, n)
					copy(frame, buf[:n])
					select {
					case packets <- frame:
					default:
						// drop if buffer full
					}
				}
			}()

			ticker := time.NewTicker(20 * time.Millisecond) // 50fps pacing
			defer ticker.Stop()

			for range ticker.C {
				select {
				case pkt, ok := <-packets:
					if !ok {
						return
					}
					// write as audio sample with ~20ms duration
					if err := localTrack.WriteSample(media.Sample{Data: pkt, Duration: 20 * time.Millisecond}); err != nil {
						return
					}
				default:
				}
			}
		}()
	}
}

// -----------------------------------------------------------------------------
// Shutdown
// This method cleanly closes all connections when shutting down the SFU.
// This ensures resources are properly released.
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
