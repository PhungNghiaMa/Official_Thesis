package business

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

// ConvertToKTX2 tries to convert an image to KTX2 using the 'toktx' CLI tool.
// Returns fileBuffer and fileName for Pinata upload, or error.
func ConvertToKTX2(inputPath string) ([]byte, string, error) {
	ktx2Path := inputPath + ".ktx2"
	cmd := exec.Command("toktx", "--bcmp", ktx2Path, inputPath)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return nil, "", fmt.Errorf("ktx2 conversion failed: %v, output: %s", err, string(out))
	}
	fileBuffer, err := os.ReadFile(ktx2Path)
	if err != nil {
		return nil, "", fmt.Errorf("read ktx2 file: %w", err)
	}
	return fileBuffer, filepath.Base(ktx2Path), nil
}
