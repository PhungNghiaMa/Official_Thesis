package image

import (
	"context"
	"errors"
	"fmt"
	"main/model"

	"gorm.io/gorm"
)

type Repository interface {
	UploadAsset(ctx context.Context, ImageInfor model.ImageStruct, DetailUploadInfor model.DetailUploadInfor) error
	GetAsset(ctx context.Context, RoomID int) ([]model.ResponseMetadataInfor, error)
	CheckSimilarAsset(ctx context.Context, AssetCID string) (bool, error)
}

type ImgRepo struct {
	database *gorm.DB
}

func NewRepository(db *gorm.DB) *ImgRepo {
	return &ImgRepo{database: db}
}

func (Repository *ImgRepo) UploadAsset(ctx context.Context, ImageInfor model.ImageStruct, DetailUploadInfor model.DetailUploadInfor) error {
	FileSize := int64(len(DetailUploadInfor.FileBuffer))

	// Step 1: Get the current max version for this mesh (if any)
	var maxVersion int
	Repository.database.WithContext(ctx).
		Model(&model.Asset{}).
		Where("asset_mesh_name = ?", DetailUploadInfor.MeshName).
		Select("COALESCE(MAX(version), 0)").Scan(&maxVersion)

	// Step 2: Create the asset with next version
	newAsset := model.Asset{
		AssetCID:              ImageInfor.IpfsHash,
		AssetMeshName:         DetailUploadInfor.MeshName,
		AssetName:             ImageInfor.Filename,
		Title:                 DetailUploadInfor.Title,
		VietnameseDescription: DetailUploadInfor.VietnameseDescription,
		EnglishDescription:    DetailUploadInfor.EnglishDescription,
		RoomID:                uint(DetailUploadInfor.RoomID),
		Filesize:              FileSize,
		CategoryID:            uint(ImageInfor.CategoryID),
		Version:               maxVersion + 1, // auto-increment version
	}

	return Repository.database.WithContext(ctx).Create(&newAsset).Error
}


func (Repository *ImgRepo) GetAsset(ctx context.Context, RoomID int) ([]model.ResponseMetadataInfor, error) {
	room_id := uint(RoomID)
	var Assets []model.ResponseMetadataInfor

	// Subquery to get latest version per mesh
	subQuery := Repository.database.Model(&model.Asset{}).
		Select("asset_mesh_name, MAX(version) as max_version").
		Where("room_id = ?", room_id).
		Group("asset_mesh_name")

	// Join with main Asset table to get full data
	result := Repository.database.WithContext(ctx).
		Model(&model.Asset{}).
		Select("assets.asset_mesh_name", "assets.asset_cid", "assets.title", "assets.vietnamese_description", "assets.english_description").
		Joins("JOIN (?) as latest ON assets.asset_mesh_name = latest.asset_mesh_name AND assets.version = latest.max_version", subQuery).
		Where("assets.room_id = ?", room_id).
		Scan(&Assets)

	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 0 {
		fmt.Println("No assets found in room")
		return []model.ResponseMetadataInfor{}, nil
	}
	return Assets, nil
}


// CheckSimilarAsset checks if an asset with the given AssetCID already exists in the database.
// It returns true if the asset exists, false if it does not, and an error for any other database issue.
func (Repository *ImgRepo) CheckSimilarAsset(ctx context.Context, AssetCID string) (bool, error) {
	var asset model.Asset
	// We only need to check for existence, so selecting a single, small field like the primary key is efficient.
	err := Repository.database.WithContext(ctx).Model(&model.Asset{}).Select("asset_id").Where("asset_cid = ?", AssetCID).First(&asset).Error

	if err != nil {
		// If the error is gorm.ErrRecordNotFound, it means the asset doesn't exist, which is not a true "error" for our check.
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, nil
		}
		// For any other database error, we return it.
		return false, err
	}

	// If err is nil, a record was found.
	return true, nil
}
