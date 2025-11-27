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


type PinataUploadResponse struct {
	IpfsHash    string `json:"IpfsHash"`
	PinSize     int    `json:"PinSize"`
	Timestamp   string `json:"Timestamp"`
	IsDuplicate bool   `json:"isDuplicate"`
}

// PinataRepository interface for uploaders
type PinataRepository interface {
	UploadAssetToPinata(fileBuffer []byte, originalFileName string, progressChannel string, assetCID string , pw *model.ProgressWriter) (model.AssetStruct, error)
	UploadAudioToPinata(fileBuffer []byte, fileName string, progressChannel string, assetCID string , language string) (model.AudioStruct, error)
	UploadVideoToPinata(folderPath string , progressChannel string, assetCID string) (model.AssetStruct, error);
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



func GetFolderSize(folderPath string) (int64, error) {
	var total int64;
	err := filepath.Walk(folderPath, func(path string, info os.FileInfo, err error) error {
	if err == nil && !info.IsDir() {
		total += info.Size()
	}
	return nil
    })
    return total, err
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
// UploadAssetToPinataWithWriter streams a file to Pinata using a provided ProgressWriter
func (r *PinataRepo) UploadAssetToPinata( fileBuffer []byte, originalFileName string, progressChannel string, assetCID string, pwriter *model.ProgressWriter) (model.AssetStruct, error) {

    now := time.Now()
    var assetInfo model.AssetStruct
    cid := assetCID
    if cid == "" {
        cid = "pending"
    }

    // --- File categorization ---
    extensionFileName := filepath.Ext(originalFileName)
    basename := strings.TrimSuffix(originalFileName, extensionFileName)
    ext := strings.TrimPrefix(strings.ToLower(extensionFileName), ".")
    var folderName string

    if slices.Contains(allowImageType, ext) {
        assetInfo.CategoryID = 1
        folderName = "Asset_Image"
    } else if slices.Contains(allow3DType, ext) {
        assetInfo.CategoryID = 3
        folderName = "Asset_3D"
    } else {
        return model.AssetStruct{}, fmt.Errorf("invalid file type: only png, webp, jpg, jpeg, mp4, mov, avi, glb, gltf are allowed")
    }

    timestamp := strings.ReplaceAll(strings.ReplaceAll(strings.ReplaceAll(now.Format(time.RFC3339Nano), ":", "-"), ".", "-"), "Z", "")
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

        // Use provided ProgressWriter if not nil
        var dst io.Writer = part
        if pwriter != nil {
            dst = io.MultiWriter(part, pwriter)
        }

        _, err = io.Copy(dst, rdr)
        if err != nil {
            _ = pw.CloseWithError(fmt.Errorf("copy file failed: %w", err))
            return
        }

        // Add metadata
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

    // --- Authentication ---
    if r.PinataService != nil && r.PinataService.JWT != "" {
        req.Header.Set("Authorization", "Bearer "+r.PinataService.JWT)
    } else {
        apiKey := strings.TrimSpace(os.Getenv("PINATA_API_KEY"))
        apiSecret := strings.TrimSpace(os.Getenv("PINATA_API_SECRET"))
        if apiKey == "" || apiSecret == "" {
            return model.AssetStruct{}, fmt.Errorf("missing Pinata credentials")
        }
        req.Header.Set("pinata_api_key", apiKey)
        req.Header.Set("pinata_secret_api_key", apiSecret)
    }

    client := &http.Client{Timeout: 5 * time.Minute}
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

    return assetInfo, nil
}
// UploadAudioToPinata — same JWT logic as above
func (r *PinataRepo) UploadAudioToPinata(audioData []byte, fileName string, progressChannel string, assetCID string, language string) (model.AudioStruct, error) {
    apiURL := "https://api.pinata.cloud/pinning/pinFileToIPFS"
    pr, pw := io.Pipe()
    writer := multipart.NewWriter(pw)
	var uploaded int64 = 0;

    go func() {
        defer pw.Close()
        part, _ := writer.CreateFormFile("file", fileName)

        rdr := bytes.NewReader(audioData)
        pwriter := &model.ProgressWriter{
			Written: &uploaded,
            Total: int64(len(audioData)),
            ReportFunc: func(percent int) {
                if progressChannel != "" {
                    websocket.GlobalHub.BroadcastProgress(progressChannel, map[string]interface{}{
                        "type":      "tts",
                        "stage":     "upload",
                        "status":    "in_progress",
                        "progress":  percent,
                        "asset_cid": assetCID,
                        "language":  language,
                        "message":   fmt.Sprintf("%s audio upload %d%%", language, percent),
                        "timestamp": time.Now().UTC().Format(time.RFC3339),
                    })
                }
            },
        }

        _, _ = io.Copy(io.MultiWriter(part, pwriter), rdr)

        meta := map[string]interface{}{
            "name": fileName,
            "keyvalues": map[string]string{
                "folder": "Audio",
            },
        }
        metaJSON, _ := json.Marshal(meta)
        _ = writer.WriteField("pinataMetadata", string(metaJSON))
        _ = writer.Close()
    }()

    req, _ := http.NewRequest("POST", apiURL, pr)
    req.Header.Set("Content-Type", writer.FormDataContentType())

    // Authentication
    if r.PinataService != nil && r.PinataService.JWT != "" {
        req.Header.Set("Authorization", "Bearer "+r.PinataService.JWT)
    } else {
        apiKey := strings.TrimSpace(os.Getenv("PINATA_API_KEY"))
        apiSecret := strings.TrimSpace(os.Getenv("PINATA_API_SECRET"))
        req.Header.Set("pinata_api_key", apiKey)
        req.Header.Set("pinata_secret_api_key", apiSecret)
    }

    client := &http.Client{Timeout: 10 * time.Minute}
    resp, _ := client.Do(req)
    defer resp.Body.Close()

    respBytes, _ := io.ReadAll(resp.Body)
    var audioResp model.AudioStruct
    _ = json.Unmarshal(respBytes, &audioResp)

    // ✅ Final broadcast
    if progressChannel != "" {
        websocket.GlobalHub.BroadcastProgress(progressChannel, map[string]interface{}{
            "type":      "tts",
            "stage":     "upload",
            "status":    "completed",
            "progress":  100,
            "cid":       audioResp.IpfsHash,
            "asset_cid": assetCID,
            "language":  language,
            "message":   fmt.Sprintf("%s TTS audio uploaded successfully.", language),
            "timestamp": time.Now().UTC().Format(time.RFC3339),
        })
    }

    return audioResp, nil
}



func (r *PinataRepo) UploadVideoToPinata(folderPath string, progressChannel string, assetCID string) (model.AssetStruct, error) {
    apiURL := "https://api.pinata.cloud/pinning/pinFileToIPFS"

    var uploaded int64 = 0
    var cid string
    if assetCID == "" {
        cid = "pending"
    } else {
        cid = assetCID
    }

    totalSize, err := GetFolderSize(folderPath)
    if err != nil {
        return model.AssetStruct{}, fmt.Errorf("failed to calculate folder size: %w", err)
    }

    // Create multipart body
    body := &bytes.Buffer{}
    mw := multipart.NewWriter(body)

    // REQUIRED: this tells Pinata to wrap all files inside a root folder (one CID)
    // mw.WriteField("pinataOptions", `{"wrapWithDirectory": true}`)
    // uniqueName := "hls_video_" + uuid.New().String()
    // mw.WriteField("pinataMetadata", fmt.Sprintf(`{"name": "%s"}`, uniqueName))

    walkErr := filepath.Walk(folderPath, func(path string, info os.FileInfo, err error) error {
        if err != nil || info.IsDir() {
            return err
        }

        relPath, err := filepath.Rel(folderPath, path)
        if err != nil {
            return err
        }
        relPath = filepath.ToSlash(relPath)


        file, err := os.Open(path)
        if err != nil {
            return err
        }
        defer file.Close()

        
        // Force everything under a root folder
        uploadPath := filepath.Join("video", relPath)
        uploadPath = filepath.ToSlash(uploadPath)

        part, err := mw.CreateFormFile("file", uploadPath)
        if err != nil {
            return err
        }

        pwriter := &model.ProgressWriter{
            Written: &uploaded,
            Total: totalSize,
            ReportFunc: func(percent int) {
                websocket.GlobalHub.BroadcastProgress(progressChannel, map[string]interface{}{
                    "stage":     "upload",
                    "status":    "in_progress",
                    "progress":  percent,
                    "asset_cid": cid,
                    "message":   fmt.Sprintf("Uploading folder: %d%% complete", percent),
                })
            },
        }

        _, err = io.Copy(io.MultiWriter(part, pwriter), file)
        return err
    })

    if walkErr != nil {
        return model.AssetStruct{}, fmt.Errorf("failed to walk folder: %w", walkErr)
    }

    mw.Close()

    // Create request
    req, err := http.NewRequest("POST", apiURL, body)
    if err != nil {
        return model.AssetStruct{}, fmt.Errorf("failed to create HTTP request: %w", err)
    }
    req.Header.Set("Content-Type", mw.FormDataContentType())

    // Pinata Authentication
    if r.PinataService != nil && r.PinataService.JWT != "" {
        req.Header.Set("Authorization", "Bearer "+r.PinataService.JWT)
    } else {
        apiKey := strings.TrimSpace(os.Getenv("PINATA_API_KEY"))
        apiSecret := strings.TrimSpace(os.Getenv("PINATA_API_SECRET"))
        if apiKey == "" || apiSecret == "" {
            return model.AssetStruct{}, fmt.Errorf("missing Pinata credentials")
        }
        req.Header.Set("pinata_api_key", apiKey)
        req.Header.Set("pinata_secret_api_key", apiSecret)
    }

    client := &http.Client{Timeout: 10 * time.Minute}
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

    if progressChannel != "" {
        websocket.GlobalHub.BroadcastProgress(progressChannel, map[string]interface{}{
            "stage":     "upload",
            "status":    "completed",
            "progress":  100,
            "asset_cid": pinataResp.IpfsHash,
            "message":   "Video folder uploaded successfully.",
            "timestamp": time.Now().UTC().Format(time.RFC3339),
        })
    }

    return model.AssetStruct{
        Filename:   filepath.Base(folderPath),
        IpfsHash:   pinataResp.IpfsHash,
        CategoryID: 2,
    }, nil
}
