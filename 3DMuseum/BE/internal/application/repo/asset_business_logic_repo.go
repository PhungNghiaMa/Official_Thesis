package applicationRepository

import (
	"context"
	applicationDTO "main/internal/application/dto"
)

// PinataRepository interface for Pinata operations
type PinataRepository interface {
	UploadAssetToPinata(fileBuffer []byte, originalFileName string, progressChannel string, assetCID string , pw *applicationDTO.ProgressWriter) (applicationDTO.AssetStruct, error)
	UploadAudioToPinata(websocketRepo WebsocketRepository,fileBuffer []byte, fileName string, progressChannel string, assetCID string , language string) (applicationDTO.AudioStruct, error)
	UploadVideoToPinata(websocketRepo WebsocketRepository,folderPath string , progressChannel string, assetCID string) (applicationDTO.AssetStruct, error);
}

// ImageConvertRepository interface for image conversion operations
type ImageConvertRepository interface {
	ConvertToWebP(inputPath string) ([]byte, string, error);
	ConvertToKTX2(inputPath string) ([]byte, string, error);
}

// TTSServiceRepository interface for TTS operations
type TTSRepository interface {
	GenerateAudio(ctx context.Context, description, language, mesh string) ([]byte, string, error)
}

// VideoConvertRepository interface for video conversion operations
type VideoConvertRepository interface {
	ConvertToHLS(ctx context.Context, inputPath string) (*applicationDTO.VideoConversionResult, error)
}

