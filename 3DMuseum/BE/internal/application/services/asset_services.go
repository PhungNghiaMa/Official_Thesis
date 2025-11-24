package services

import (
	"context"
	"fmt"
	applicationDTO "main/internal/application/dto"
	applicationRepository "main/internal/application/repo"
	model "main/internal/domain"
	business "main/internal/infrastructure/business"
	websocket "main/internal/infrastructure/websocket"
	"maps"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

var (
	ErrorAssetExist error
)
var GlobalHub *websocket.WebSocketHub = websocket.NewWebSocketHub()

// Mutex to protect all WebSocket write operations
var wsWriteMutex sync.Mutex 

type ImageUploadResult struct {
	Success  bool   `json:"success"`
	AssetCID string `json:"asset_cid"`
	WebpCID  string `json:"webp_cid,omitempty"`
	Message  string `json:"message,omitempty"`
	Category string `json:"category,omitempty"`
}

type VideoUploadResult struct {
	Success   bool   `json:"success"`
	AssetCID  string `json:"asset_cid"`
	Message   string `json:"message,omitempty"`
	Thumbnail string `json:"thumbnail_cid,omitempty"`
	Category string `json:"category,omitempty"`

}

type AssetUploadResult struct {
	Success   bool   `json:"success"`
	AssetCID  string `json:"asset_cid"`
	WebpCID string `json:"webp_cid,omitempty"` // For the video , later if we want to update Thumbnail then just use this WebpCID as the path to Thumbnail image store on Pinata
	Message   string `json:"message,omitempty"`
	Category string `json:"category,omitempty"`
}

type Service interface {
	UploadAsset(Context context.Context, DetailUploadInfor model.DetailUploadInfor) (*AssetUploadResult, error)
	GetAsset(Context context.Context, RoomID int) ([]model.ResponseMetadataInfor, error)
}

type AssetService struct {
	AssetRepo  applicationRepository.Repository
	PinataRepo applicationRepository.PinataRepository
	TTSRepo    applicationRepository.TTSRepository
	WebsocketRepo applicationRepository.WebsocketRepository
	ImageConvertRepo applicationRepository.ImageConvertRepository
	VideoConvertRepo applicationRepository.VideoConvertRepository

}

func NewService(AssetRepo applicationRepository.Repository, PinataRepo applicationRepository.PinataRepository, TTSRepo applicationRepository.TTSRepository, WebsocketRepo applicationRepository.WebsocketRepository, ImageConvertRepo applicationRepository.ImageConvertRepository, VideoConvertRepo applicationRepository.VideoConvertRepository) *AssetService {
	return &AssetService{AssetRepo: AssetRepo, PinataRepo: PinataRepo, TTSRepo: TTSRepo, WebsocketRepo: WebsocketRepo, ImageConvertRepo: ImageConvertRepo, VideoConvertRepo: VideoConvertRepo}
}

func (s *AssetService) UploadAsset(ctx context.Context, info model.DetailUploadInfor) (*AssetUploadResult, error) {
    var totalImageSize int64 = 0;
	var uploaded int64 = 0;
	var isVideoUpload bool = false;
	roomChannel := "room:" + strconv.Itoa(info.RoomID)
	var assetCID string; // we'll fill this later when known
	var assetUploadResult *AssetUploadResult;
	
	// Check what type of uploade asset (video or image)
	ext := strings.ToLower(filepath.Ext(info.Filename))
	if ext == ".mp4" || ext == ".mov" || ext == ".avi" {
		isVideoUpload = true
	}

	// --- unified helper to broadcast to BOTH room and asset channels ---
	reportProgress := func(stage, status string, progress int, message string, extra map[string]interface{}) {
		now := time.Now()
		msg := map[string]interface{}{
			"type": func() string {
				switch {
				case strings.HasPrefix(stage, "tts") && stage != "tts_schedule":
					return "tts"
				case strings.Contains(stage, "upload") || strings.Contains(stage, "convert") ||
					strings.Contains(stage, "database") || strings.Contains(stage, "pipeline") || stage == "tts_schedule":
					return "upload"
				default:
					return "upload"
				}
			}(),
			"stage":     stage,
			"status":    status,
			"message":   message,
			"progress":  progress,
			"asset_cid": func() string { if assetCID != "" { return assetCID } else { return "pending" } }(),
			"timestamp": now.UTC().Format(time.RFC3339),
		}
		if extra != nil {
			maps.Copy(msg, extra)
		}

		wsWriteMutex.Lock()
		defer wsWriteMutex.Unlock()

		s.WebsocketRepo.BroadCastProgress(roomChannel, msg)
		if assetCID != "" {
			s.WebsocketRepo.BroadCastProgress("asset:"+assetCID, msg)
		}
	}

	// Store the input file to temporary file
	tempPath := filepath.Join(os.TempDir(), fmt.Sprintf("%d-%s", time.Now().UnixNano(), filepath.Base(info.Filename)))
		if err := os.WriteFile(tempPath, info.FileBuffer, 0644); err != nil {
			return &AssetUploadResult{}, fmt.Errorf("failed to save temp file: %w", err)
		}
	defer os.Remove(tempPath)

	if !isVideoUpload{
		// 1) Convert to KTX2
		reportProgress("convert", "starting", 3, "Converting image to KTX2...", map[string]interface{}{"asset_cid": "pending"})
		ktx2Buffer, ktx2Name, err := s.ImageConvertRepo.ConvertToKTX2(tempPath)
		if err != nil {
			reportProgress("convert", "failed", 6, "KTX2 conversion failed, using original image.", map[string]interface{}{"error": err.Error(), "asset_cid": "pending"})
			ktx2Buffer = info.FileBuffer
			ktx2Name = info.Filename
		} else {
			reportProgress("convert", "completed", 10, "KTX2 conversion finished.", map[string]interface{}{"asset_cid": "pending"})
		}
		totalImageSize += int64(len(ktx2Buffer))

		// 2) Convert to WebP (best-effort)
		reportProgress("convert_webp", "starting", 12, "Converting to WebP (fallback)...", map[string]interface{}{"asset_cid": assetCID})
		webpBuffer, webpName, err := s.ImageConvertRepo.ConvertToWebP(tempPath)
		if err != nil {
			reportProgress("convert_webp", "failed", 15, "WebP conversion failed", map[string]interface{}{"error": err.Error(), "asset_cid": assetCID})
		} else {
			reportProgress("convert_webp", "completed", 20, "WebP conversion done", map[string]interface{}{"asset_cid": assetCID})
		}
		totalImageSize += int64(len(webpBuffer))

		// --- Shared progress writer across both uploads ---
		progressWriter := &applicationDTO.ProgressWriter{
			Written: &uploaded,
			Total: totalImageSize,
			ReportFunc: func(percent int) {
				// Scale into pipeline range (20–90%)
				scaled := 20 + int(float64(percent)*0.7)
				reportProgress("upload", "in_progress", scaled, fmt.Sprintf("Uploading image: %d%% complete", scaled), map[string]interface{}{"asset_cid": "pending"})
			},
		}

		// 3) Upload KTX2
		reportProgress("upload", "starting", 20, "Uploading KTX2 to Pinata...", map[string]interface{}{"asset_cid": "pending"})
		ktx2Resp, err := s.PinataRepo.UploadAssetToPinata(ktx2Buffer, ktx2Name, roomChannel, "", progressWriter)
		if err != nil {
			reportProgress("upload", "failed", 0, "Failed to upload KTX2 to Pinata", map[string]interface{}{"error": err.Error(), "asset_cid": "pending"})
			return &AssetUploadResult{}, fmt.Errorf("pinata upload failed: %w", err)
		}
		assetCID = ktx2Resp.IpfsHash

		// 4) Upload WebP
		var webpCID string
		if len(webpBuffer) > 0 {
			reportProgress("upload_webp", "starting", 20, "Uploading WebP fallback...", map[string]interface{}{"asset_cid": assetCID})
			if webpResp, err := s.PinataRepo.UploadAssetToPinata(webpBuffer, webpName, roomChannel, assetCID, progressWriter); err == nil {
				webpCID = webpResp.IpfsHash
			} else {
				reportProgress("upload_webp", "failed", 25, "WebP upload failed", map[string]interface{}{"error": err.Error(), "asset_cid": assetCID})
			}
		}

		// ✅ Final upload broadcast (combined KTX2 + WebP)
		reportProgress("upload", "completed", 90, "Image upload completed", map[string]interface{}{"asset_cid": assetCID, "webp_cid": webpCID})

		// 5) Save to DB
		reportProgress("database", "starting", 92, "Saving metadata to database...", map[string]interface{}{"asset_cid": assetCID})
		if err := s.AssetRepo.UpsertAsset(ctx, ktx2Resp, webpCID, info); err != nil {
			reportProgress("database", "failed", 95, "DB error while saving asset", map[string]interface{}{"error": err.Error(), "asset_cid": assetCID})
			return &AssetUploadResult{}, err
		}
		reportProgress("database", "completed", 97, "Metadata saved", map[string]interface{}{"asset_cid": assetCID})

		// 6) Schedule TTS
		reportProgress("tts_schedule", "starting", 98, "Scheduling audio generation (background)...", map[string]interface{}{"asset_cid": assetCID})
		go s.ProcessAudioJobs(assetCID, info)

		// Final pipeline message
		reportProgress("pipeline", "completed", 100, "Upload pipeline completed; audio generating", map[string]interface{}{"asset_cid": assetCID})
		assetUploadResult = &AssetUploadResult{
			Success:  true,
			AssetCID: assetCID,
			WebpCID:  webpCID,
			Message:  "Upload successfully",
			Category: "image",
		}
	}else{
		// 1. Convert to HLS
		reportProgress("convert", "starting", 3, "Converting video to HLS...", map[string]interface{}{"asset_cid": "pending"})
		VideoConversionResult, err := s.VideoConvertRepo.ConvertToHLS(ctx , tempPath)
		if err != nil {
			reportProgress("convert", "failed", 6, "Fail to convert video to HLS", map[string]interface{}{"error": err.Error(), "asset_cid": "pending"})
			return &AssetUploadResult{}, fmt.Errorf("fail to convert video to HLS: %w", err)
		}

		// 2. Upload conversion HLS to Pinata 
		reportProgress("upload", "starting", 90, "Uploading KTX2 to Pinata...", map[string]interface{}{"asset_cid": "pending"})
		uploadVideoResponse , err := s.PinataRepo.UploadVideoToPinata(GlobalHub ,VideoConversionResult.FolderPath , roomChannel , "");
		if err != nil {
			reportProgress("upload", "failed", 0, "Failed to upload Video to Pinata", map[string]interface{}{"error": err.Error(), "asset_cid": "pending"})
			return &AssetUploadResult{}, fmt.Errorf("pinata upload failed: %w", err)
		}

		assetCID = uploadVideoResponse.IpfsHash

		// 3. Upload Data to database
		reportProgress("database", "starting", 92, "Saving metadata to database...", map[string]interface{}{"asset_cid": assetCID})
		if err := s.AssetRepo.UpsertAsset(ctx, uploadVideoResponse, "", info); err != nil {
			reportProgress("database", "failed", 95, "DB error while saving asset", map[string]interface{}{"error": err.Error(), "asset_cid": assetCID})
			return &AssetUploadResult{}, err
		}
		reportProgress("database", "completed", 97, "Metadata saved", map[string]interface{}{"asset_cid": assetCID})

		// 5) Schedule TTS
		reportProgress("tts_schedule", "starting", 98, "Scheduling audio generation (background)...", map[string]interface{}{"asset_cid": assetCID})
		go s.ProcessAudioJobs(assetCID, info)

		// Final pipeline message
		reportProgress("pipeline", "completed", 100, "Upload pipeline completed; audio generating", map[string]interface{}{"asset_cid": assetCID})
		assetUploadResult= &AssetUploadResult{
			Success:  true,
			AssetCID: assetCID,
			Message:  "Upload successfully",
			Category: "video",
		}

	}
	return assetUploadResult, nil
}


// ProcessAudioJobs processes EN/VI TTS for a single assetCID with concurrency per language.
// Now includes human-readable WebSocket messages and timestamps.
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

			_, err := s.AssetRepo.InsertAudio(ctx, assetCID, j.Lang, j.Text)
			if err != nil {
				// If we can't insert into DB, we should probably stop here
				fmt.Printf("❌ Failed to insert initial audio record for %s: %v\n", j.Lang, err)
				return
			}

			// 1️⃣ Check cache
			existing, err := s.AssetRepo.FindAudioByHash(ctx, textHash, j.Lang)
			if err == nil && existing.AudioCID != "" {
				_ = s.AssetRepo.UpdateAudio(ctx, assetCID, j.Lang, "completed", existing.AudioCID, attempts)
				msg := map[string]interface{}{
					"type":       "tts",
					"language":   j.Lang,
					"status":     "completed",
					"asset_cid":  assetCID,
					"cid":        existing.AudioCID,
					"progress":   100,
					"message":    fmt.Sprintf("Reused existing %s TTS audio.", j.Lang),
					"timestamp":  time.Now().UTC().Format(time.RFC3339),
				}
				s.WebsocketRepo.BroadCastProgress(assetChannel, msg)
				s.WebsocketRepo.BroadCastProgress(roomChannel, msg)
				return
			}

			// 2️⃣ Mark as processing
			_ = s.AssetRepo.UpdateAudio(ctx, assetCID, j.Lang, "processing", "", attempts)
			progressMsg := func(p int, msg string) {
				extra := map[string]interface{}{"asset_cid": assetCID}
				reportProgressAudio(s , assetChannel, j.Lang, "processing", msg, p, extra)
				reportProgressAudio(s , roomChannel, j.Lang, "processing", msg, p, extra)
			}

			progressMsg(10, fmt.Sprintf("Generating %s TTS audio...", j.Lang))
			progressMsg(30, fmt.Sprintf("Waiting for %s TTS generation...", j.Lang))

			simCtx, cancelSim := context.WithCancel(ctx)

			// 2.5️⃣ Simulated gradual progress 30–60%
			simTicker := time.NewTicker(1 * time.Second)
			go func() {
				defer simTicker.Stop()
				for p := 35; p <= 60; p += 5 {
					select {
					case <-simTicker.C:
						progressMsg(p, fmt.Sprintf("Still generating %s TTS audio...", j.Lang))
					case <-simCtx.Done():
						return	
					}
				}
			}()

			// 3️⃣ Generate TTS
			audioData, fileName, err := s.TTSRepo.GenerateAudio(ctx, j.Text, j.Lang, detail.MeshName)
			cancelSim()
			if err != nil {
				attempts++
				_ = s.AssetRepo.UpdateAudio(ctx, assetCID, j.Lang, "failed", "", attempts)
				extra := map[string]interface{}{"asset_cid": assetCID, "error": err.Error()}
				reportProgressAudio(s , assetChannel, j.Lang, "failed", fmt.Sprintf("Failed to generate %s TTS audio.", j.Lang), 0, extra)
				reportProgressAudio(s , roomChannel, j.Lang, "failed", fmt.Sprintf("Failed to generate %s TTS audio.", j.Lang), 0, extra)
				return
			}

			progressMsg(70, fmt.Sprintf("Uploading %s TTS audio to Pinata...", j.Lang))

			// 4️⃣ Upload to Pinata
			resp, err := s.PinataRepo.UploadAudioToPinata(GlobalHub , audioData, fileName, assetChannel, assetCID, j.Lang)
			if err != nil {
				attempts++
				_ = s.AssetRepo.UpdateAudio(ctx, assetCID, j.Lang, "failed", "", attempts)
				extra := map[string]interface{}{"asset_cid": assetCID, "error": err.Error()}
				reportProgressAudio(s , assetChannel, j.Lang, "failed", fmt.Sprintf("Failed to upload %s TTS audio.", j.Lang), 0, extra)
				reportProgressAudio(s , roomChannel, j.Lang, "failed", fmt.Sprintf("Failed to upload %s TTS audio.", j.Lang), 0, extra)
				return
			}

			duration := time.Since(start).Milliseconds()
			_ = s.AssetRepo.UpdateAudio(ctx, assetCID, j.Lang, "completed", resp.IpfsHash, attempts)

			// 5️⃣ Completion
			extra := map[string]interface{}{
				"asset_cid": assetCID,
				"cid":       resp.IpfsHash,
				"duration":  duration,
			}
			reportProgressAudio(s, assetChannel, j.Lang, "completed", fmt.Sprintf("%s TTS audio uploaded successfully.", j.Lang), 100, extra)
			reportProgressAudio(s , roomChannel, j.Lang, "completed", fmt.Sprintf("%s TTS audio uploaded successfully.", j.Lang), 100, extra)
		}(j)
	}

	wg.Wait()
	fmt.Printf("✅ All TTS audio jobs completed for asset %s\n", assetCID)
}

func (AssetService *AssetService) GetAsset(context context.Context, RoomID int) ([]model.ResponseMetadataInfor, error) {
	assetList, err := AssetService.AssetRepo.GetAsset(context, RoomID)
	return assetList, err
}


func reportProgressAudio(s *AssetService , channel, lang, status, message string, progress int, extra map[string]interface{}) {
	msg := map[string]interface{}{
		"type":       "tts",
		"language":   lang,
		"status":     status,
		"message":    message,
		"progress":   progress,
		"timestamp":  time.Now().UTC().Format(time.RFC3339),
	}
	maps.Copy(msg, extra)
	wsWriteMutex.Lock()
	defer wsWriteMutex.Unlock()
	s.WebsocketRepo.BroadCastProgress(channel, msg)
}