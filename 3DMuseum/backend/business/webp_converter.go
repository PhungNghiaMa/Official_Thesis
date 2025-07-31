package business

import (
	"bytes"
	"fmt"
	"image"
	"os"
	"path/filepath"
	"strings"
	"github.com/chai2010/webp"
)

// ConvertImageToWebpBufferAndName converts an image to WEBP and returns the bytes + new filename.
func ConvertImageToWebpBufferAndName(inputPath string) ([]byte, string, error) {
	var buffer bytes.Buffer

	// 1. Handle case where input is already WEBP
	ext := strings.ToLower(filepath.Ext(inputPath))
	base := strings.TrimSuffix(filepath.Base(inputPath), ext)
	newFileName := base + ".webp"

	if ext == ".webp" {
		fmt.Println("Input is already a WEBP file. Reading bytes directly.")
		data, err := os.ReadFile(inputPath)
		if err != nil {
			return nil, "", fmt.Errorf("failed to read WEBP file '%s': %v", inputPath, err)
		}
		return data, newFileName, err
	}

	// 2. Open and decode the image
	inputFile, err := os.Open(inputPath)
	if err != nil {
		return nil, "", fmt.Errorf("failed to open input file '%s': %v", inputPath, err)
	}
	defer inputFile.Close()

	img, format, err := image.Decode(inputFile)
	if err != nil {
		return nil, "", fmt.Errorf("failed to decode image '%s': %v", inputPath, err)
	}
	fmt.Printf("Successfully decoded image, format: %s\n", format)

	// 3. Encode to WEBP based on format
	switch format {
	case "jpeg":
		err = webp.Encode(&buffer, img, &webp.Options{Quality: 85})
	case "png":
		err = webp.Encode(&buffer, img, &webp.Options{Lossless: true})
	default:
		return nil, "", fmt.Errorf("unsupported image format: %s", format)
	}

	if err != nil {
		return nil, "", fmt.Errorf("failed to encode to WEBP: %v", err)
	}

	fmt.Println("Image converted to WEBP buffer successfully!")

	return buffer.Bytes(), newFileName, nil
}
