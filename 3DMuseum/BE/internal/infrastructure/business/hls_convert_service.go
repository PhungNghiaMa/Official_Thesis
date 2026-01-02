package business

import (
	"bytes"
	"context"
	"fmt"
	applicationDTO "main/internal/application/dto"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type HLSConvertRepo struct{}

func NewHLSConvertRepo() *HLSConvertRepo {
	return &HLSConvertRepo{}
}

type VideoResolution struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

// Helper functions (DetectVideoResolution, HasAudioStream, RemuxVideo, GetVideoDuration) 
func DetectVideoResolution(inputPath string) (*VideoResolution, error) {
	cmd := exec.Command("ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", inputPath)
	var output bytes.Buffer
	cmd.Stdout = &output
	if err := cmd.Run(); err != nil {
		return nil, err
	}
	parts := strings.Split(strings.TrimSpace(output.String()), ",")
	width, _ := strconv.Atoi(parts[0])
	height, _ := strconv.Atoi(parts[1])
	return &VideoResolution{Width: width, Height: height}, nil
}

func HasAudioStream(inputPath string) (bool, error) {
	cmd := exec.Command("ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", inputPath)
	var out bytes.Buffer
	cmd.Stdout = &out
	if err := cmd.Run(); err != nil {
		return false, nil
	}
	return strings.TrimSpace(out.String()) != "", nil
}

func RemuxVideo(inputPath string) (string, error) {
	remuxedPath := filepath.Join(os.TempDir(), fmt.Sprintf("remuxed_%d.mp4", time.Now().UnixNano()))
	cmd := exec.Command("ffmpeg", "-i", inputPath, "-c", "copy", "-fflags", "+genpts", "-reset_timestamps", "1", remuxedPath)
	if err := cmd.Run(); err != nil {
		return "", err
	}
	return remuxedPath, nil
}

func GetVideoDuration(inputPath string) (int, error) {
	cmd := exec.Command("ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", inputPath)
	var out bytes.Buffer
	cmd.Stdout = &out
	if err := cmd.Run(); err != nil {
		return 0, err
	}
	durFloat, _ := strconv.ParseFloat(strings.TrimSpace(out.String()), 64)
	return int(durFloat), nil
}

func (r *HLSConvertRepo) ConvertToHLS(ctx context.Context, inputPath string) (*applicationDTO.VideoConversionResult, error) {
	tempDirectory := filepath.Join(os.TempDir(), fmt.Sprintf("video_%d", time.Now().UnixNano()))
	if err := os.MkdirAll(tempDirectory, 0755); err != nil {
		return nil, err
	}

	// 1. Remux
	remuxedPath, err := RemuxVideo(inputPath)
	if err != nil {
		return nil, err
	}
	defer os.Remove(remuxedPath)

	// 2. Phân tích video
	videoResolution, err := DetectVideoResolution(remuxedPath)
	if err != nil {
		return nil, err
	}
	hasAudio, err := HasAudioStream(remuxedPath)
	if err != nil {
		return nil, err
	}

	// 3. Cấu hình theo style cũ của bạn
	// Sử dụng "stream_%v/stream.m3u8" để FFmpeg tự tạo thư mục stream_0/
	segmentPath := "stream_%v/segment_%03d.ts"
	variantPath := "stream_%v/stream.m3u8"
	manifestName := "master.m3u8"

	// Smart scale: không vượt quá 720p
	targetH := videoResolution.Height
	if targetH > 720 {
		targetH = 720
	}
	if targetH%2 != 0 { targetH-- }

	// 4. Build Command
	args := []string{
		"-i", remuxedPath,
		"-filter:v:0", fmt.Sprintf("scale=-2:%d", targetH),
		"-c:v:0", "libx264", "-preset", "veryfast", "-crf", "23", "-g", "48", "-keyint_min", "48", "-sc_threshold", "0",
	}

	if hasAudio {
		args = append(args, "-c:a:0", "aac", "-b:a:0", "128k", "-map", "0:v", "-map", "0:a")
		args = append(args, "-var_stream_map", "v:0,a:0")
	} else {
		args = append(args, "-an", "-map", "0:v")
		args = append(args, "-var_stream_map", "v:0")
	}

	args = append(args,
		"-f", "hls", "-hls_time", "4", "-hls_playlist_type", "vod", "-hls_flags", "independent_segments",
		"-master_pl_name", manifestName,
		"-hls_segment_filename", segmentPath,
		variantPath,
	)

	cmd := exec.CommandContext(ctx, "ffmpeg", args...)
	cmd.Dir = tempDirectory
	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("ffmpeg failed: %v\n%s", err, stderr.String())
	}

	// 5. Thu thập thông tin trả về
	duration, _ := GetVideoDuration(remuxedPath)
	var segments []string
	// Scan folder stream_0 to find .ts file
	_ = filepath.Walk(tempDirectory, func(path string, info os.FileInfo, err error) error {
		if err == nil && !info.IsDir() && strings.HasSuffix(info.Name(), ".ts") {
			// Extract relative path (VD: stream_0/segment_001.ts)
			rel, _ := filepath.Rel(tempDirectory, path)
			segments = append(segments, rel)
		}
		return nil
	})

	return &applicationDTO.VideoConversionResult{
		FolderPath: tempDirectory,
		M3U8:       manifestName,
		Segments:   segments,
		Duration:   duration,
		Resolution: []string{fmt.Sprintf("%dp", targetH)},
	}, nil
}