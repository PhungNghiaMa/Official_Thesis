package business

import (
	"crypto/sha256"
	"encoding/hex"
)

func HashTextSHA256(text string) string {
	hash := sha256.Sum256([]byte(text))
	return hex.EncodeToString(hash[:])
}
