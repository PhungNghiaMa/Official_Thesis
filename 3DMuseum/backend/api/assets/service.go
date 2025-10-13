package assets

import (
	"context"
	"fmt"
	"main/business"
	"main/model"
	"main/websocket"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"
)

var (
	ErrorAssetExist error
)

type UploadResult struct {
	Success  bool   `json:"success"`
	AssetCID string `json:"asset_cid"`
	WebpCID  string `json:"webp_cid,omitempty"`
	Message  string `json:"message,omitempty"`
}

type Service interface {
	UploadAsset(Context context.Context, DetailUploadInfor model.DetailUploadInfor) (*UploadResult, error)
	GetAsset(Context context.Context, RoomID int) ([]model.ResponseMetadataInfor, error)
}

type AssetService struct {
	AssetRepo  Repository
	PinataRepo business.PinataRepository
	TTSRepo    business.TTSRepository
}

func NewService(AssetRepo Repository, PinataRepo business.PinataRepository, TTSRepo business.TTSRepository) *AssetService {
	return &AssetService{AssetRepo: AssetRepo, PinataRepo: PinataRepo, TTSRepo: TTSRepo}
}

// UploadAsset uploads the converted (ktx2 / webp fallback) asset, stores DB, and schedules TTS jobs.
func (s *AssetService) UploadAsset(ctx context.Context, info model.DetailUploadInfor) (*UploadResult, error) {
	// Save temp file (many converters expect a path)
	tempPath := filepath.Join(os.TempDir(), fmt.Sprintf("%d-%s", time.Now().UnixNano(), filepath.Base(info.Filename)))
	if err := os.WriteFile(tempPath, info.FileBuffer, 0644); err != nil {
		return &UploadResult{}, fmt.Errorf("failed to save temp file: %w", err)
	}
	defer os.Remove(tempPath)

	// Convert to KTX2 (preferred). Fallback to original bytes if conversion fails.
	ktx2Buffer, ktx2Name, err := business.ConvertToKTX2(tempPath)
	if err != nil {
		fmt.Printf("[WARN] KTX2 conversion failed: %v\n", err)
		ktx2Buffer = info.FileBuffer
		ktx2Name = info.Filename
	}

	// WebP fallback (best-effort)
	webpBuffer, webpName, err := business.ConvertToWebP(tempPath)
	if err != nil {
		fmt.Printf("[WARN] WebP conversion failed: %v\n", err)
	}

	// Broadcast: room-level upload started (so any admins in same room know something is happening)
	roomChannel := "room:" + strconv.Itoa(info.RoomID)
	websocket.GlobalHub.BroadcastProgress(roomChannel, map[string]interface{}{
		"type":     "upload",
		"status":   "starting",
		"message":  "upload starting",
		"progress": 5,
	})

	// Upload primary (KTX2 or original) to Pinata
	ktx2Resp, err := s.PinataRepo.UploadAssetToPinata(ktx2Buffer, ktx2Name, roomChannel)
	if err != nil {
		websocket.GlobalHub.BroadcastProgress(roomChannel, map[string]interface{}{
			"type":     "upload",
			"status":   "failed",
			"error":    err.Error(),
			"progress": 0,
		})
		return &UploadResult{}, fmt.Errorf("pinata KTX2 upload failed: %w", err)
	}

	assetChannel := "asset:" + ktx2Resp.IpfsHash

	// Broadcast: uploaded primary
	websocket.GlobalHub.BroadcastProgress(assetChannel, map[string]interface{}{
		"type":      "upload",
		"asset_cid": ktx2Resp.IpfsHash,
		"status":    "uploaded",
		"progress":  60,
	})
	websocket.GlobalHub.BroadcastProgress(roomChannel, map[string]interface{}{
		"type":      "upload",
		"asset_cid": ktx2Resp.IpfsHash,
		"status":    "uploaded",
		"progress":  60,
	})

	// Upload webp as fallback (optional)
	var webpCID string
	if len(webpBuffer) > 0 {
		if webpResp, err := s.PinataRepo.UploadAssetToPinata(webpBuffer, webpName, roomChannel); err == nil {
			webpCID = webpResp.IpfsHash
		} else {
			fmt.Printf("[WARN] webp upload failed: %v\n", err)
		}
	}

	// Upsert asset in DB with fallback info
	if err := s.AssetRepo.UpsertAsset(ctx, ktx2Resp, webpCID, info); err != nil {
		// commit DB error but still let system know
		websocket.GlobalHub.BroadcastProgress(assetChannel, map[string]interface{}{
			"type":     "upload",
			"status":   "db_error",
			"error":    err.Error(),
			"progress": 80,
		})
		return &UploadResult{}, err
	}

	// Broadcast finalization
	websocket.GlobalHub.BroadcastProgress(assetChannel, map[string]interface{}{
		"type":      "upload",
		"asset_cid": ktx2Resp.IpfsHash,
		"status":    "completed",
		"progress":  100,
	})
	websocket.GlobalHub.BroadcastProgress(roomChannel, map[string]interface{}{
		"type":      "upload",
		"asset_cid": ktx2Resp.IpfsHash,
		"status":    "completed",
		"progress":  100,
	})

	// Create audio jobs records in DB
	if info.EnglishDescription != "" {
		_, _ = s.AssetRepo.InsertAudio(ctx, ktx2Resp.IpfsHash, "en", info.EnglishDescription)
	}
	if info.VietnameseDescription != "" {
		_, _ = s.AssetRepo.InsertAudio(ctx, ktx2Resp.IpfsHash, "vi", info.VietnameseDescription)
	}

	// Launch async TTS processing
	go s.ProcessAudioJobs(ktx2Resp.IpfsHash, info)

	var response = &UploadResult{
		Success:  true,
		AssetCID: ktx2Resp.IpfsHash,
		WebpCID:  webpCID,
		Message:  "Upload successfully",
	}

	return response, nil
}

func (AssetService *AssetService) GetAsset(context context.Context, RoomID int) ([]model.ResponseMetadataInfor, error) {
	assetList, err := AssetService.AssetRepo.GetAsset(context, RoomID)
	return assetList, err
}

// ProcessAudioJobs processes EN/VI TTS for a single assetCID with concurrency per language.
func (s *AssetService) ProcessAudioJobs(assetCID string, detail model.DetailUploadInfor) {
	ctx := context.Background()

	type job struct {
		Lang string
		Text string
	}
	jobs := []job{
		{"en", detail.EnglishDescription},
		{"vi", detail.VietnameseDescription},
	}

	var wg sync.WaitGroup

	roomChannel := "room:" + strconv.Itoa(detail.RoomID)
	assetChannel := "asset:" + assetCID

	for _, j := range jobs {
		if j.Text == "" {
			continue
		}
		wg.Add(1)
		go func(j job) {
			defer wg.Done()

			textHash := business.HashTextSHA256(j.Text)
			attempts := 0
			start := time.Now()

			// Check for deduplicated audio by text hash
			existing, err := s.AssetRepo.FindAudioByHash(ctx, textHash, j.Lang)
			if err == nil && existing.AudioCID != "" {
				// reuse
				_ = s.AssetRepo.UpdateAudio(ctx, assetCID, j.Lang, "completed", existing.AudioCID, attempts)
				msg := map[string]interface{}{
					"type":     "tts",
					"language": j.Lang,
					"status":   "completed",
					"cid":      existing.AudioCID,
					"progress": 100,
				}
				websocket.GlobalHub.BroadcastProgress(assetChannel, msg)
				websocket.GlobalHub.BroadcastProgress(roomChannel, msg)
				return
			}

			// Mark processing and broadcast
			_ = s.AssetRepo.UpdateAudio(ctx, assetCID, j.Lang, "processing", "", attempts)
			websocket.GlobalHub.BroadcastProgress(assetChannel, map[string]interface{}{
				"type":     "tts",
				"language": j.Lang,
				"status":   "processing",
				"progress": 10,
			})
			websocket.GlobalHub.BroadcastProgress(roomChannel, map[string]interface{}{
				"type":     "tts",
				"language": j.Lang,
				"status":   "processing",
				"progress": 10,
			})

			// Generate audio
			audioData, fileName, err := s.TTSRepo.GenerateAudio(ctx, j.Text, j.Lang, detail.MeshName)
			if err != nil {
				attempts++
				_ = s.AssetRepo.UpdateAudio(ctx, assetCID, j.Lang, "failed", "", attempts)
				websocket.GlobalHub.BroadcastProgress(assetChannel, map[string]interface{}{
					"type":     "tts",
					"language": j.Lang,
					"status":   "failed",
					"progress": 0,
				})
				websocket.GlobalHub.BroadcastProgress(roomChannel, map[string]interface{}{
					"type":     "tts",
					"language": j.Lang,
					"status":   "failed",
					"progress": 0,
				})
				return
			}

			// Upload audio
			websocket.GlobalHub.BroadcastProgress(assetChannel, map[string]interface{}{
				"type":     "tts",
				"language": j.Lang,
				"status":   "uploading",
				"progress": 70,
			})
			websocket.GlobalHub.BroadcastProgress(roomChannel, map[string]interface{}{
				"type":     "tts",
				"language": j.Lang,
				"status":   "uploading",
				"progress": 70,
			})

			resp, err := s.PinataRepo.UploadAudioToPinata(audioData, fileName, assetChannel)
			if err != nil {
				attempts++
				_ = s.AssetRepo.UpdateAudio(ctx, assetCID, j.Lang, "failed", "", attempts)
				websocket.GlobalHub.BroadcastProgress(assetChannel, map[string]interface{}{
					"type":     "tts",
					"language": j.Lang,
					"status":   "failed",
					"progress": 0,
				})
				websocket.GlobalHub.BroadcastProgress(roomChannel, map[string]interface{}{
					"type":     "tts",
					"language": j.Lang,
					"status":   "failed",
					"progress": 0,
				})
				return
			}

			duration := time.Since(start).Milliseconds()
			_ = s.AssetRepo.UpdateAudio(ctx, assetCID, j.Lang, "completed", resp.IpfsHash, attempts)

			// Broadcast completion to both channels
			websocket.GlobalHub.BroadcastProgress(assetChannel, map[string]interface{}{
				"type":     "tts",
				"language": j.Lang,
				"status":   "completed",
				"cid":      resp.IpfsHash,
				"progress": 100,
				"duration": duration,
			})
			websocket.GlobalHub.BroadcastProgress(roomChannel, map[string]interface{}{
				"type":     "tts",
				"language": j.Lang,
				"status":   "completed",
				"cid":      resp.IpfsHash,
				"progress": 100,
				"duration": duration,
			})
		}(j)
	}

	wg.Wait()
	fmt.Printf("All TTS audio jobs completed for asset %s\n", assetCID)
}
