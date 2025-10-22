package business

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

func ConvertToKTX2(inputPath string) ([]byte, string, error) {
	outputFile := filepath.Join(os.TempDir(), "temp_output.ktx2")

	// Delete the outputFile from system so it not account the computer memory 
	// Because later on the content of the output file is copy and this deletion just executed before it return 
	// so that deleting the outputFile is totally safe
	defer func() {
		_ = os.Remove(outputFile)
	}()

	cmd := exec.Command("toktx",
		"--t2", "--encode", "etc1s", "--genmipmap",
		outputFile,
		inputPath,
	)



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
