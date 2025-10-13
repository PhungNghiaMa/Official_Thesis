package business

import (
	"context"
	"fmt"
	"os"
	"strings"

	texttospeech "cloud.google.com/go/texttospeech/apiv1"
	texttospeechpb "cloud.google.com/go/texttospeech/apiv1/texttospeechpb"
)

type TTSRepository interface {
	GenerateAudio(ctx context.Context, description string, language string, ImageMeshName string) ([]byte, string, error)
}

// TTSSercice handles Google Text-to-Speech operations
type TTSService struct {
	client *texttospeech.Client
}

func NewTTSRepo() *TTSService {
	fmt.Println("GOOGLE_APPLICATION_CREDENTIALS:", os.Getenv("GOOGLE_APPLICATION_CREDENTIALS"))
	ctx := context.Background()
	client, err := texttospeech.NewClient(ctx)
	if err != nil {
		panic(fmt.Sprintf("failed to initialize TTS client: %v", err))
	}
	return &TTSService{client: client}
}

func (tts *TTSService) GenerateAudio(ctx context.Context, description, language, mesh string) ([]byte, string, error) {

	var langCode string
	switch language {
	case "en":
		langCode = "en-US"
	default:
		langCode = "vi-VN"
	}
	input := &texttospeechpb.SynthesisInput{InputSource: &texttospeechpb.SynthesisInput_Text{Text: description}}
	voice := &texttospeechpb.VoiceSelectionParams{LanguageCode: langCode, SsmlGender: texttospeechpb.SsmlVoiceGender_NEUTRAL}
	audioCfg := &texttospeechpb.AudioConfig{AudioEncoding: texttospeechpb.AudioEncoding_MP3}
	req := &texttospeechpb.SynthesizeSpeechRequest{Input: input, Voice: voice, AudioConfig: audioCfg}
	resp, err := tts.client.SynthesizeSpeech(ctx, req)
	if err != nil {
		return nil, "", fmt.Errorf("TTS synthesis failed: %v", err)
	}
	return resp.AudioContent, fmt.Sprintf("tts_%s_%s.mp3", mesh, strings.ToUpper(language)), nil
}
