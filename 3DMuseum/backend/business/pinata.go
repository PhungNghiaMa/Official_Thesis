package business

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"main/model"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"main/websocket"

	"golang.org/x/exp/slices"
)

// progressReader reports upload progress via websocket channel
type progressReader struct {
	r            io.Reader
	total        int64
	sent         int64
	lastPercent  int
	lastReportTs time.Time
	ch           string
	typ          string // "upload" or "tts"
}

func (pr *progressReader) Read(p []byte) (int, error) {
	n, err := pr.r.Read(p)
	if n > 0 {
		pr.sent += int64(n)
		if pr.total > 0 {
			percent := int((pr.sent * 100) / pr.total)
			now := time.Now()
			if percent != pr.lastPercent || now.Sub(pr.lastReportTs) > 200*time.Millisecond {
				pr.lastPercent = percent
				pr.lastReportTs = now
				if pr.ch != "" {
					websocket.GlobalHub.BroadcastProgress(pr.ch, map[string]interface{}{
						"type":     pr.typ,
						"status":   "uploading",
						"progress": percent,
					})
				}
			}
		}
	}
	return n, err
}

type PinataUploadResponse struct {
	IpfsHash    string `json:"IpfsHash"`
	PinSize     int    `json:"PinSize"`
	Timestamp   string `json:"Timestamp"`
	IsDuplicate bool   `json:"isDuplicate"`
}

// PinataRepository interface for uploaders
type PinataRepository interface {
	UploadAssetToPinata(fileBuffer []byte, originalFileName string, progressChannel string) (model.AssetStruct, error)
	UploadAudioToPinata(fileBuffer []byte, fileName string, progressChannel string) (model.AudioStruct, error)
}

// ------------------------
// PinataRepo + Service
// ------------------------
type PinataRepo struct {
	PinataService *PinataService
}

type PinataService struct {
	JWT        string
	GatewayURL string
}

func NewPinataService(jwt, gatewayURL string) *PinataService {
	return &PinataService{JWT: jwt, GatewayURL: gatewayURL}
}

func NewPinataRepo(PinataService *PinataService) *PinataRepo {
	return &PinataRepo{PinataService: PinataService}
}

// Allowed file types
var allowImageType = []string{"webp", "png", "jpg", "jpeg", "ktx2"}
var allowVideoType = []string{"mp4", "mov", "avi"}
var allow3DType = []string{"glb", "gltf"}

// UploadAssetToPinata streams the file to Pinata and reports progress to frontend.
func (r *PinataRepo) UploadAssetToPinata(fileBuffer []byte, originalFileName string, progressChannel string) (model.AssetStruct, error) {
	now := time.Now()
	var assetInfo model.AssetStruct

	// --- File categorization ---
	timestamp := strings.ReplaceAll(strings.ReplaceAll(strings.ReplaceAll(now.Format(time.RFC3339Nano), ":", "-"), ".", "-"), "Z", "")
	extensionFileName := filepath.Ext(originalFileName)
	basename := strings.TrimSuffix(originalFileName, extensionFileName)
	ext := strings.TrimPrefix(strings.ToLower(extensionFileName), ".")
	var folderName string

	if slices.Contains(allowImageType, ext) {
		assetInfo.CategoryID = 1
		folderName = "Asset_Image"
	} else if slices.Contains(allowVideoType, ext) {
		assetInfo.CategoryID = 2
		folderName = "Asset_Video"
	} else if slices.Contains(allow3DType, ext) {
		assetInfo.CategoryID = 3
		folderName = "Asset_3D"
	} else {
		return model.AssetStruct{}, fmt.Errorf("invalid file type: only png, webp, jpg, jpeg, mp4, mov, avi, glb, gltf are allowed")
	}

	newFileName := fmt.Sprintf("%s_%s%s", basename, timestamp, extensionFileName)
	apiURL := "https://api.pinata.cloud/pinning/pinFileToIPFS"

	// --- Build streaming multipart form ---
	pr, pw := io.Pipe()
	writer := multipart.NewWriter(pw)

	go func() {
		defer pw.Close()

		part, err := writer.CreateFormFile("file", newFileName)
		if err != nil {
			_ = pw.CloseWithError(fmt.Errorf("create form file failed: %w", err))
			return
		}

		rdr := bytes.NewReader(fileBuffer)
		progR := &progressReader{r: rdr, total: int64(len(fileBuffer)), ch: progressChannel, typ: "upload"}
		if _, err = io.Copy(part, progR); err != nil {
			_ = pw.CloseWithError(fmt.Errorf("copy file failed: %w", err))
			return
		}

		meta := map[string]interface{}{
			"name": newFileName,
			"keyvalues": map[string]string{
				"folder": folderName,
			},
		}
		metaJSON, _ := json.Marshal(meta)
		_ = writer.WriteField("pinataMetadata", string(metaJSON))

		if err := writer.Close(); err != nil {
			_ = pw.CloseWithError(fmt.Errorf("writer close failed: %w", err))
		}
	}()

	req, err := http.NewRequest("POST", apiURL, pr)
	if err != nil {
		return model.AssetStruct{}, fmt.Errorf("failed to create HTTP request: %w", err)
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())

	// --- Authentication handling ---
	if r.PinataService != nil && r.PinataService.JWT != "" {
		req.Header.Set("Authorization", "Bearer "+r.PinataService.JWT)
	} else {
		apiKey := strings.TrimSpace(os.Getenv("PINATA_API_KEY"))
		apiSecret := strings.TrimSpace(os.Getenv("PINATA_API_SECRET"))
		if apiKey == "" || apiSecret == "" {
			return model.AssetStruct{}, fmt.Errorf("missing Pinata credentials: please set JWT or API key/secret")
		}
		req.Header.Set("pinata_api_key", apiKey)
		req.Header.Set("pinata_secret_api_key", apiSecret)
	}

	client := &http.Client{Timeout: 0}
	resp, err := client.Do(req)
	if err != nil {
		return model.AssetStruct{}, fmt.Errorf("failed to send request to Pinata: %w", err)
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return model.AssetStruct{}, fmt.Errorf("failed to read Pinata response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return model.AssetStruct{}, fmt.Errorf("Pinata API returned %d - %s", resp.StatusCode, string(respBytes))
	}

	var pinataResp PinataUploadResponse
	if err := json.Unmarshal(respBytes, &pinataResp); err != nil {
		return model.AssetStruct{}, fmt.Errorf("failed to parse Pinata response JSON: %w", err)
	}

	assetInfo.Filename = basename
	assetInfo.IpfsHash = pinataResp.IpfsHash

	if progressChannel != "" {
		websocket.GlobalHub.BroadcastProgress(progressChannel, map[string]interface{}{
			"type":     "upload",
			"status":   "completed",
			"progress": 100,
		})
	}
	return assetInfo, nil
}

// UploadAudioToPinata — same JWT logic as above
func (r *PinataRepo) UploadAudioToPinata(audioData []byte, fileName string, progressChannel string) (model.AudioStruct, error) {
	apiURL := "https://api.pinata.cloud/pinning/pinFileToIPFS"
	pr, pw := io.Pipe()
	writer := multipart.NewWriter(pw)
	var folderName = "Audio"

	go func() {
		defer pw.Close()
		part, err := writer.CreateFormFile("file", fileName)
		if err != nil {
			_ = pw.CloseWithError(fmt.Errorf("create form file: %w", err))
			return
		}

		rdr := bytes.NewReader(audioData)
		progR := &progressReader{r: rdr, total: int64(len(audioData)), ch: progressChannel, typ: "tts"}
		if _, err := io.Copy(part, progR); err != nil {
			_ = pw.CloseWithError(fmt.Errorf("copy audio failed: %w", err))
			return
		}

		meta := map[string]interface{}{
			"name": fileName,
			"keyvalues": map[string]string{
				"folder": folderName,
			},
		}
		metaJSON, _ := json.Marshal(meta)
		_ = writer.WriteField("pinataMetadata", string(metaJSON))

		if err := writer.Close(); err != nil {
			_ = pw.CloseWithError(fmt.Errorf("writer close: %w", err))
			return
		}
	}()

	req, err := http.NewRequest("POST", apiURL, pr)
	if err != nil {
		return model.AudioStruct{}, fmt.Errorf("failed to create HTTP request: %w", err)
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())

	if r.PinataService != nil && r.PinataService.JWT != "" {
		req.Header.Set("Authorization", "Bearer "+r.PinataService.JWT)
	} else {
		apiKey := strings.TrimSpace(os.Getenv("PINATA_API_KEY"))
		apiSecret := strings.TrimSpace(os.Getenv("PINATA_API_SECRET"))
		if apiKey == "" || apiSecret == "" {
			return model.AudioStruct{}, fmt.Errorf("missing Pinata credentials: please set JWT or API key/secret")
		}
		req.Header.Set("pinata_api_key", apiKey)
		req.Header.Set("pinata_secret_api_key", apiSecret)
	}

	client := &http.Client{Timeout: 0}
	resp, err := client.Do(req)
	if err != nil {
		return model.AudioStruct{}, fmt.Errorf("failed to send request to Pinata: %w", err)
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return model.AudioStruct{}, fmt.Errorf("failed to read Pinata response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return model.AudioStruct{}, fmt.Errorf("Pinata API returned %d - %s", resp.StatusCode, string(respBytes))
	}

	var audioResp model.AudioStruct
	if err := json.Unmarshal(respBytes, &audioResp); err != nil {
		return model.AudioStruct{}, fmt.Errorf("failed to unmarshal Pinata audio response: %w", err)
	}

	if progressChannel != "" {
		websocket.GlobalHub.BroadcastProgress(progressChannel, map[string]interface{}{
			"type":     "tts",
			"status":   "completed",
			"progress": 100,
			"cid":      audioResp.IpfsHash,
		})
	}

	return audioResp, nil
}
