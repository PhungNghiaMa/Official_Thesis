package applicationRepository

import (
	"context"
	applicationDTO "main/internal/application/dto"
	model "main/internal/domain"
)

type Repository interface {
	UpsertAsset(ctx context.Context, ktx2Resp applicationDTO.AssetStruct, webpCID string, info model.DetailUploadInfor) error
	GetAsset(ctx context.Context, RoomID int) ([]model.ResponseMetadataInfor, error)
	InsertAudio(ctx context.Context, assetCID, language, description string) (*model.Audio, error)
	FindAudioByHash(ctx context.Context, textHash string, language string) (*model.Audio, error)
	UpdateAudio(ctx context.Context, assetCID string, language string, status, audioCID string, attempts int) error
	FetchPendingAudioJobs(ctx context.Context, limit int) ([]model.Audio, error)
}