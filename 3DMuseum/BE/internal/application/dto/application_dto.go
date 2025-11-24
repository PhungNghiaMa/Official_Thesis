package applicationDTO

import (
	"sync/atomic"
)

// ProgressWriter is used to track progress of an operation
type ProgressWriter struct {
	Written    *int64
	Total      int64
	ReportFunc func(percent int)
}

// Write implements the io.Writer interface for ProgressWriter
func (pw *ProgressWriter) Write(p []byte) (int, error) {
	n := len(p)
	// atomically add to shared counter
	newWritten := atomic.AddInt64(pw.Written, int64(n))
	percent := int(float64(newWritten) / float64(pw.Total) * 100)
	if pw.ReportFunc != nil {
		pw.ReportFunc(percent)
	}
	return n, nil
}

// VideoConversionResult holds the result of a video conversion to HLS
type VideoConversionResult struct {
	FolderPath string `json:"folder_path"`
	M3U8 string `json:"m3u8"`
	Segments []string `json:"segments"`
	Duration int `json:"duration"`
	Resolution []string `json:"resolution"` 
}

// Pinata response models for asset
type AssetStruct struct {
	Filename string
	IpfsHash string // Asset_CID
	CategoryID int
}

// Pinata response models for audio
type AudioStruct struct{
	IpfsHash string `json:"IPFSHash"` // AudioCID
}

