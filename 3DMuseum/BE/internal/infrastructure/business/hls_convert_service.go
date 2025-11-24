package business

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	applicationDTO "main/internal/application/dto"
)

type HLSConvertRepo struct {}

func NewHLSConvertRepo() *HLSConvertRepo {
	return &HLSConvertRepo{}
}

type VideoResolution struct{
	Width int `json:"width"`
	Height int `json:"height"`
}



// Helper function to get uploaded video resolution 
func DetectVideoResolution(inputPath string)(*VideoResolution, error){
	cmd := exec.Command(
        "ffprobe",
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-of", "csv=p=0",
        inputPath,
    )
	
	var output bytes.Buffer
	cmd.Stdout = &output
	if err := cmd.Run(); err != nil {
        return nil, fmt.Errorf("[DetectVideoResolution] Failed to detect video resolution: %w", err);
    }


	parts := strings.Split(strings.TrimSpace(output.String()), ",")
    if len(parts) != 2 {
        return nil, fmt.Errorf("unexpected ffprobe output: %s", output.String())
    }
	// Assign value for width and height from the result get from command execution
    width, _ := strconv.Atoi(parts[0])
    height, _ := strconv.Atoi(parts[1])

	return &VideoResolution{Width: width, Height: height}, nil
}

// Helper function to detect if uploaded video has audio stream 
func HasAudioStream(inputPath string) (bool, error) {
    cmd := exec.Command(
        "ffprobe",
        "-v", "error",
        "-select_streams", "a",
        "-show_entries", "stream=index",
        "-of", "csv=p=0",
        inputPath,
    )

    var out bytes.Buffer
    cmd.Stdout = &out
    if err := cmd.Run(); err != nil {
        // Return an error so caller can decide how to proceed
        return false, fmt.Errorf("[HasAudioStream] ffprobe failed: %w", err)
    }

    return strings.TrimSpace(out.String()) != "", nil
}

// Helper function to get video duration in seconds 
func GetVideoDuration(inputPath string)(int, error){
	cmd := exec.Command(
        "ffprobe",
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
		inputPath,
    )
	
	var out bytes.Buffer
	cmd.Stdout = &out
	if err := cmd.Run(); err != nil {
        return 0, fmt.Errorf("[GetVideoDuration] Failed to get video duration: %w", err);
    }
	durStr := strings.TrimSpace(out.String())
    durFloat, _ := strconv.ParseFloat(durStr, 64)
    return int(durFloat), nil
}

// Helper function to extract resolution from .meu8 file 
func ExtractResolutionsFromM3U8(masterPath string) ([]string, error) {
    data, err := os.ReadFile(masterPath)
    if err != nil {
        return nil, err
    }
    var variants []string
    lines := strings.Split(string(data), "\n")
    for _, line := range lines {
        if strings.HasPrefix(line, "#EXT-X-STREAM-INF") {
            // Example: #EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
            if strings.Contains(line, "RESOLUTION=") {
                parts := strings.Split(line, "RESOLUTION=")
                res := strings.Split(parts[1], ",")[0]
                variants = append(variants, res)
            }
        }
    }
    return variants, nil
}

func(r *HLSConvertRepo) ConvertToHLS(ctx context.Context, inputPath string) (*applicationDTO.VideoConversionResult, error) {
    tempDirectory := filepath.Join(os.TempDir(), fmt.Sprintf("video_%d", time.Now().UnixNano()))
    if err := os.MkdirAll(tempDirectory, 0755); err != nil {
        return nil, fmt.Errorf("failed to create temp dir: %w", err)
    }

    videoResolution, err := DetectVideoResolution(inputPath)
    if err != nil {
        return nil, err
    }

    var command []string
    var manifestName string

    hasAudio, err := HasAudioStream(inputPath)
    if err != nil {
        return nil, err
    }

    if videoResolution.Height <= 720 {
        // Single resolution
        segmentPath := "segment_%03d.ts"
        manifestPath := "stream.m3u8"
        if hasAudio {
            command = []string{
                "ffmpeg", "-i", inputPath,
                "-vf", "scale=w=1280:h=720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2",
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                "-c:a", "aac", "-b:a", "128k",
                "-f", "hls", "-hls_time", "4", "-hls_playlist_type", "vod",
                "-hls_segment_filename", segmentPath,
                manifestPath,
            }
        } else {
            // No audio stream: disable audio and avoid any audio mapping/options
            command = []string{
                "ffmpeg", "-i", inputPath,
                "-vf", "scale=w=1280:h=720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2",
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                "-an",
                "-f", "hls", "-hls_time", "4", "-hls_playlist_type", "vod",
                "-hls_segment_filename", segmentPath,
                manifestPath,
            }
        }
        manifestName = "stream.m3u8"
    } else {
        // Multi resolution
        // segmentPath := filepath.Join(tempDirectory, "stream_%v/segment_%03d.ts")
        // variantPath := filepath.Join(tempDirectory, "stream_%v.m3u8")
        segmentPath := "stream_%v/segment_%03d.ts"
        variantPath := "stream_%v/stream.m3u8"
        if hasAudio {
            command = []string{
                "ffmpeg", "-i", inputPath,
                "-filter:v:0", "scale=w=426:h=240:force_original_aspect_ratio=decrease,pad=426:240:(ow-iw)/2:(oh-ih)/2",
                "-c:v:0", "libx264", "-b:v:0", "400k", "-c:a:0", "aac", "-b:a:0", "64k",
                "-filter:v:1", "scale=w=640:h=360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2",
                "-c:v:1", "libx264", "-b:v:1", "800k", "-c:a:1", "aac", "-b:a:1", "96k",
                "-filter:v:2", "scale=w=1280:h=720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2",
                "-c:v:2", "libx264", "-b:v:2", "2500k", "-c:a:2", "aac", "-b:a:2", "128k",
                "-filter:v:3", "scale=w=1920:h=1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2",
                "-c:v:3", "libx264", "-b:v:3", "5000k", "-c:a:3", "aac", "-b:a:3", "192k",
                "-map", "0:v", "-map", "0:a", // Maps to v:0, a:0
                "-map", "0:v", "-map", "0:a", // Maps to v:1, a:1
                "-map", "0:v", "-map", "0:a", // Maps to v:2, a:2
                "-map", "0:v", "-map", "0:a", // Maps to v:3, a:3
                "-f", "hls", "-hls_time", "4", "-hls_playlist_type", "vod",
                "-var_stream_map", "v:0,a:0 v:1,a:1 v:2,a:2 v:3,a:3",
                "-master_pl_name", "master.m3u8",
                "-hls_segment_filename", segmentPath,
                variantPath,
            }
        } else {
            // No audio: drop audio mapping and per-variant audio options, and var_stream_map only contains video
            command = []string{
                "ffmpeg", "-i", inputPath,
                "-filter:v:0", "scale=w=426:h=240:force_original_aspect_ratio=decrease,pad=426:240:(ow-iw)/2:(oh-ih)/2",
                "-c:v:0", "libx264", "-b:v:0", "400k",
                "-filter:v:1", "scale=w=640:h=360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2",
                "-c:v:1", "libx264", "-b:v:1", "800k",
                "-filter:v:2", "scale=w=1280:h=720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2",
                "-c:v:2", "libx264", "-b:v:2", "2500k",
                "-filter:v:3", "scale=w=1920:h=1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2",
                "-c:v:3", "libx264", "-b:v:3", "5000k",
                "-map", "0:v", // Maps to v:0
                "-map", "0:v", // Maps to v:1
                "-map", "0:v", // Maps to v:2
                "-map", "0:v", // Maps to v:3
                "-f", "hls", "-hls_time", "4", "-hls_playlist_type", "vod",
                "-var_stream_map", "v:0 v:1 v:2 v:3",
                "-master_pl_name", "master.m3u8",
                "-hls_segment_filename", segmentPath,
                variantPath,
            }
        }
        manifestName = "master.m3u8"
    }


    cmd := exec.Command(command[0], command[1:]...)
    // This tells ffmpeg to run *inside* the temp folder
    cmd.Dir = tempDirectory
    var stderr bytes.Buffer
    cmd.Stderr = &stderr
    if err := cmd.Run(); err != nil {
        return nil, fmt.Errorf("ffmpeg failed: %v\n%s", err, stderr.String())
    }


    duration, _ := GetVideoDuration(inputPath)

    var segments []string
    _ = filepath.Walk(tempDirectory, func(path string, info os.FileInfo, err error) error {
        if err == nil && !info.IsDir() && strings.HasSuffix(info.Name(), ".ts") {
            segments = append(segments, info.Name())
        }
        return nil
    })

    var resolutions []string
    if manifestName == "master.m3u8" {
        resolutions, _ = ExtractResolutionsFromM3U8(filepath.Join(tempDirectory, "master.m3u8"))
    }

    return &applicationDTO.VideoConversionResult{
        FolderPath: tempDirectory,
        M3U8:       manifestName,
        Segments:   segments,
        Duration:   duration,
        Resolution: resolutions,
    }, nil
}
