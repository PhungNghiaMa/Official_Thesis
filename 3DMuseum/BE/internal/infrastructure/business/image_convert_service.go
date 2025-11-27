package business

import (
	"bytes"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/chai2010/webp"
)

type ImageConvertRepo struct {}

func NewImageConvertRepo() *ImageConvertRepo {
	return &ImageConvertRepo{}
}

// --- KTX2 CONVERSION FUNCTION ---
// Helper function to round up to the nearest multiple of 4
func roundToMultipleOf4(n int) int {
	if n%4 == 0 {
		return n
	}
	return (n/4 + 1) * 4
}

// Main function to convert an image to KTX2 format
func (r *ImageConvertRepo)ConvertToKTX2(inputPath string) ([]byte, string, error) {
	// --- START: Read image dimensions ---
	file, err := os.Open(inputPath)
	if err != nil {
		return nil, "", fmt.Errorf("failed to open input file: %v", err)
	}
	defer file.Close()

	config, _, err := image.DecodeConfig(file)
	if err != nil {
		return nil, "", fmt.Errorf("failed to decode image config: %v", err)
	}

	// Calculate new dimensions as multiples of 4
	newWidth := roundToMultipleOf4(config.Width)
	newHeight := roundToMultipleOf4(config.Height)
	resizeArg := fmt.Sprintf("%dx%d", newWidth, newHeight)
	// --- END: Read image dimensions ---


	outputFile := filepath.Join(os.TempDir(), "tempOutput.ktx2")
	defer func() {
		_ = os.Remove(outputFile)
	}()

    // Build the argument list
	args := []string{
		// Mandatory
		"--t2",
		"--encode", "uastc",
		"--genmipmap",

		// UASTC Configuration
		"--uastc_quality", "2", // High quality/speed balance

		// RDO: Rate-Distortion Optimization (Condition data for better compression)
		// We use the flag without a value to try the default lambda of 1.0 (more stable)
		// If you want a specific value, use: "--uastc_rdo_l", "1.0"
		"--uastc_rdo_l", 
        
		// Zstandard: Supercompress the RDO-conditioned UASTC data losslessly
		// We use compression level 3 (default) for fast, good compression.
		// For max compression (slower), try "20".
		"--zcmp", "3", 
	}

    // Add the resize argument only if resizing is needed
	if newWidth != config.Width || newHeight != config.Height {
		args = append(args, "--resize", resizeArg)
	}

    // Add the output and input file paths
    args = append(args, outputFile, inputPath)

	cmd := exec.Command("toktx", args...)

	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return nil, "", fmt.Errorf("toktx failed: %v\n%s", err, stderr.String())
	}

	// Read result
	data, err := os.ReadFile(outputFile)
	if err != nil {
		return nil, "", fmt.Errorf("failed to read KTX2 file: %v", err)
	}

	return data, filepath.Base(outputFile), nil
}


// --- WEBP CONVERSION FUNCTION ---

func (r *ImageConvertRepo) ConvertToWebP(inputPath string) ([]byte, string, error) {
	file, err := os.Open(inputPath)
	if err != nil {
		return nil, "", fmt.Errorf("failed to open file: %v", err)
	}
	defer file.Close()

	img, format, err := image.Decode(file)
	fmt.Println("DETECTED FORMAT: ", format)
	if err != nil {
		return nil, "", fmt.Errorf("failed to decode: %v", err)
	}

	var buf bytes.Buffer
	opt := &webp.Options{Quality: 90}
	if err := webp.Encode(&buf, img, opt); err != nil {
		return nil, "", fmt.Errorf("webp encode failed: %v", err)
	}

	newFile := strings.TrimSuffix(filepath.Base(inputPath), filepath.Ext(inputPath)) + ".webp"
	return buf.Bytes(), newFile, nil
}