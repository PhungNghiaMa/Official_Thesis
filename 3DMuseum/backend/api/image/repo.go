package image

import (
	"context"
	"fmt"
	"main/model"
	"errors"
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

	// DATA GET FROM FRONT-END: VietnameseDescription , EnglishDescription , RoomID


	FileSize := int64(len(DetailUploadInfor.FileBuffer)) // calculate file size
	// CREATE Asset OBJECT TO INSERT INTO Asset TABLE
	Asset := model.Asset{
		AssetCID:              ImageInfor.IpfsHash,
		AssetMeshName: 		   DetailUploadInfor.MeshName,
		AssetName:             ImageInfor.Filename,
		Title:                 DetailUploadInfor.Title,
		VietnameseDescription: DetailUploadInfor.VietnameseDescription,
		EnglishDescription:    DetailUploadInfor.EnglishDescription,
		RoomID:                uint(DetailUploadInfor.RoomID),
		Filesize:              FileSize,
		CategoryID:            uint(ImageInfor.CategoryID),
	}
	return Repository.database.WithContext(ctx).Create(&Asset).Error
}

func (Repository *ImgRepo) GetAsset(ctx context.Context, RoomID int) ([]model.ResponseMetadataInfor, error) {
	room_id := uint(RoomID)
	var Assets []model.ResponseMetadataInfor
	result := Repository.database.WithContext(ctx).Model(&model.Asset{}).
		Select("asset_mesh_name", "asset_cid", "title", "vietnamese_description", "english_description").
		Where("room_id = ?", room_id).
		Find(&Assets)

	if result.Error != nil {
		return nil, result.Error
	}

	if result.RowsAffected == 0 {
		fmt.Println("No tuple found for Asset table")
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
