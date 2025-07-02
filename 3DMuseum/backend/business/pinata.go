package business

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"main/model"
	"mime/multipart"
	"net/http"
	"path/filepath"
	"strings"
	"time" // For timestamp generation

	"golang.org/x/exp/slices"
)

type PinataUploadResponse struct {
	IpfsHash    string `json:"IpfsHash"`
	PinSize     int    `json:"PinSize"`
	Timestamp   string `json:"Timestamp"`
	IsDuplicate bool   `json:"isDuplicate"`
}

// PinataService encapsulates Pinata API interactions.
type PinataService struct {
	JWT        string
	GatewayURL string // e.g., "https://api.pinata.cloud"
}

// NewPinatService creates a new PinataService instance.
func NewPinatService(jwt, gatewayURL string) *PinataService {
	return &PinataService{
		JWT:        jwt,
		GatewayURL: gatewayURL,
	}
}

var allowImageType = []string{"webP", "png", "jpg", "jpeg"}
var allowVideoType = []string{"mp4", "mov", "avi"}

func (PinataService *PinataService) UploadToPinata(fileBuffer []byte, originalFileName string) (model.ImageStruct, error) {
	now := time.Now()
	var imageInformation model.ImageStruct
	timestamp := strings.ReplaceAll(strings.ReplaceAll(strings.ReplaceAll(now.Format(time.RFC3339Nano), ":", "-"), ".", "-"), "Z", "")

	// GET THE BASENAME AND EXTENSION FILE NAME
	extensionFileName := filepath.Ext(originalFileName)
	basename := strings.TrimSuffix(originalFileName, extensionFileName) // remove the file extension to get the basename
	ext := strings.TrimPrefix(strings.ToLower(extensionFileName), ".")
	if exist := slices.Contains(allowImageType, ext); exist == true {
		imageInformation.CategoryID = 1
	} else if exist := slices.Contains(allowVideoType, ext); exist == true {
		imageInformation.CategoryID = 2
	} else {
		return model.ImageStruct{}, fmt.Errorf("invalid file type, only png, webp, or jpg is allowed")
	}

	newFileName := fmt.Sprintf("%s_%s%s", basename, timestamp, extensionFileName)
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	// Create new form file for the acutal file content
	part, err := writer.CreateFormFile("file", newFileName) // "file" is the expected field name of Pinata
	if err != nil {
		return model.ImageStruct{}, fmt.Errorf("failed to create form file: %w", err) // Return empty struct on error
	}
	_, err = io.Copy(part, bytes.NewReader((fileBuffer)))

	if err != nil {
		return model.ImageStruct{}, fmt.Errorf("failed to copy file buffer to form file: %w", err)
	}
	writer.Close()

	// CREATE HTTP REQUEST
	req, err := http.NewRequest("POST", PinataService.GatewayURL+"pinning/pinFileToIPFS", body)
	if err != nil {
		return model.ImageStruct{}, fmt.Errorf("failed to create HTTP request: %w", err)
	}
	// SET HEADER
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+PinataService.JWT)

	// 4. SEND REQUEST
	client := &http.Client{Timeout: 30 * time.Second} // Set a timeout for the request
	resp, err := client.Do(req)
	if err != nil {
		return model.ImageStruct{}, fmt.Errorf("failed to send HTTP request to Pinata: %w", err) // Return empty struct on error
	}
	defer resp.Body.Close() // Ensure the response body is closed

	// 5. Read the response
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return model.ImageStruct{}, fmt.Errorf("failed to read Pinata response body: %w", err) // Return empty struct on error
	}

	if resp.StatusCode != http.StatusOK {
		return model.ImageStruct{}, fmt.Errorf("pinata API returned non-OK status: %d - %s", resp.StatusCode, string(respBody)) // Return empty struct on error
	}

	// 6. PARSE JSON
	var PinataResp PinataUploadResponse
	if err := json.Unmarshal(respBody, &PinataResp); err != nil {
		return model.ImageStruct{}, fmt.Errorf("failed to parse Pinata response JSON: %w", err) // Return empty struct on error
	}

	imageInformation.Filename = basename
	imageInformation.IpfsHash = PinataResp.IpfsHash
	return imageInformation, nil
}
