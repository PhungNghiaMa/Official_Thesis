package api

import (
	"fmt"
	"io"
	"main/internal/application/services"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
)

type GenAIHandler struct {
	GenAIServices services.GenAIServices
}

func NewGenAIHandler(GenAIServices services.GenAIServices) *GenAIHandler{
	return &GenAIHandler{GenAIServices: GenAIServices}
}

type PromptRequest struct {
	PlayerID string `json:"player_id"`
	CID string `json:"cid"`
	Prompt string `json:"prompt"`
	ImageBytes []byte `json:"image_bytes,omitempty"`
	MimeType string `json:"mime_type,omitempty"`
}

func fetchImageFromIPFS(cid string) ([]byte, string, error) {
    // Replace with your actual Pinata Gateway or a public one like cloudflare-ipfs.com
    url := fmt.Sprintf("https://%s/ipfs/%s",os.Getenv("PINATA_DEDICATED_GATEWAY"), cid)
    
    resp, err := http.Get(url)
    if err != nil {
        return nil, "", err
    }
    defer resp.Body.Close()

    if resp.StatusCode != http.StatusOK {
        return nil, "", fmt.Errorf("failed to fetch image: status %d", resp.StatusCode)
    }

    imageBytes, err := io.ReadAll(resp.Body)
    if err != nil {
        return nil, "", err
    }

    // Determine the MimeType (usually image/webp in your case)
    mimeType := resp.Header.Get("Content-Type")
    if mimeType == "" {
        mimeType = "image/webp" // Fallback
    }

    return imageBytes, mimeType, nil
}

func (genAIHandler *GenAIHandler) GenerateAnswer(c *gin.Context) {
    // playerID := c.PostForm("player_id")
    prompt   := c.PostForm("prompt")
    webpCID  := c.PostForm("webp_cid") 

    // 1. Download the image from Pinata/IPFS
    imageBytes, mimeType, err := fetchImageFromIPFS(webpCID)
    if err != nil {
        c.JSON(http.StatusBadGateway, gin.H{"error": "Could not retrieve image from IPFS: " + err.Error()})
        return
    }

    // 2. Call Gemini service with the downloaded bytes
    answer, err := genAIHandler.GenAIServices.GenerateAnswer(
        c.Request.Context(),
        webpCID, // Use CID as identifier
        prompt,
        imageBytes,
        mimeType,
    )

    if err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
        return
    }

    c.JSON(http.StatusOK, gin.H{"success": true, "answer": answer})
}