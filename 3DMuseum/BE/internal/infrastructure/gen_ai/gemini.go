package gen_ai

import (
	"context"
	"fmt"
	"google.golang.org/genai"
)

type GeminiClientConfig struct {
	APIKey string 
	Model string
}



type GeminiRepo struct {
	client *genai.Client
	geminiConfig *GeminiClientConfig
}


func NewGeminiClientConfig(api string , model string) *GeminiClientConfig {
	return &GeminiClientConfig{APIKey: api , Model: model}
}

func NewGeminiRepo(geminiConfig *GeminiClientConfig) *GeminiRepo {
	var ctx = context.Background()
	if client , err := genai.NewClient(ctx , &genai.ClientConfig{
		APIKey: geminiConfig.APIKey,
		Backend: genai.BackendGeminiAPI,
	}) ; err != nil {
        // Return nil for the struct and the actual error
        return nil
	}else{
		return &GeminiRepo{client: client , geminiConfig: geminiConfig}
	}
}

func (gemini *GeminiRepo) GenerateAnswer(ctx context.Context , WebpCID string , prompt string , imageBytes []byte, mimeType string) (string, error) {
	
	// 1. Create a "Parts" slice
	// Combine the text and the image into one request
	parts := []*genai.Part{
		genai.NewPartFromText(prompt),
		genai.NewPartFromBytes(imageBytes , mimeType),
	}

	// 2. Wrap parts into a "Content" slice
	contents := []*genai.Content{
		genai.NewContentFromParts(parts, genai.RoleUser),
	}

	// 3. Send the request 
	result , err := gemini.client.Models.GenerateContent(
		ctx,
		gemini.geminiConfig.Model,
		contents, // The slice of content is passed to the chat now , this include both text and image,
		nil,
	)

	if err != nil {
		return "We failed to create answer. Please try again !", fmt.Errorf("multimodal gemini error: %w", err)
	}
	
	return result.Text(), nil
}


