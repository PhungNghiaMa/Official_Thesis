package business

import (
	"bytes"
	"fmt"
	"image"
	"os"
	"path/filepath"
	"strings"
	_ "image/png"
	_ "image/jpeg"
	"github.com/chai2010/webp"
)

func ConvertToWebP(inputPath string) ([]byte, string, error) {
	file, err := os.Open(inputPath)
	if err != nil {
		return nil, "", fmt.Errorf("failed to open file: %v", err)
	}
	defer file.Close()

	img, format , err := image.Decode(file)
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
