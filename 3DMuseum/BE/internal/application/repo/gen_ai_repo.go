package applicationRepository
import (
	"context"
)

type GenAIRepo interface {
	GenerateAnswer(ctx context.Context , WebpCID string , prompt string , imageBytes []byte, mimeType string) (string, error)
}