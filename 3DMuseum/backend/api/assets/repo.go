package assets

import (
	"context"
	"errors"
	"fmt"
	"main/model"
	"time"
	"sync"
	"gorm.io/gorm"
)

type Repository interface {
	UploadAsset(ctx context.Context, ImageInfor model.ImageStruct, DetailUploadInfor model.DetailUploadInfor) error
	GetAsset(ctx context.Context, RoomID int) ([]model.ResponseMetadataInfor, error)
	CheckSimilarAsset(ctx context.Context, AssetCID string) (bool, error)
	UpdateAssetInfor(ctx context.Context, AssetCID string, DetailUploadInfor model.DetailUploadInfor) error
}

type AssetRepo struct {
	database *gorm.DB
}

func NewRepository(db *gorm.DB) *AssetRepo {
	return &AssetRepo{database: db}
}

type cachedResult struct {
	data      []model.ResponseMetadataInfor
	expiresAt time.Time
}

var (
	latestAssetsCache   = make(map[uint]cachedResult)
	latestAssetsCacheMu sync.RWMutex
	cacheTTL            = 30 * time.Second // adjust TTL as needed
)

func (Repository *AssetRepo) UploadAsset(ctx context.Context, ImageInfor model.ImageStruct, DetailUploadInfor model.DetailUploadInfor) error {
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

func (Repository *AssetRepo) GetAsset(ctx context.Context, RoomID int) ([]model.ResponseMetadataInfor, error) {

		// 1. check cache
	latestAssetsCacheMu.RLock()
	room_id := uint(RoomID)
	entry, found := latestAssetsCache[room_id]
	latestAssetsCacheMu.RUnlock()

	if found && entry.expiresAt.After(time.Now()) {
		return entry.data, nil
	}

	var Assets []model.ResponseMetadataInfor

	// Using CTE for better readability and potential performance benefits
	query := `
		SELECT DISTINCT ON (a.asset_mesh_name)
			a.asset_mesh_name,
			a.asset_cid,
			a.title,
			a.vietnamese_description,
			a.english_description
		FROM assets a
		WHERE a.room_id = ?
		ORDER BY a.asset_mesh_name, a.version DESC

	`
	result := Repository.database.WithContext(ctx).Raw(query, room_id).Scan(&Assets)

	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 0 {
		fmt.Println("No assets found in room")
		return []model.ResponseMetadataInfor{}, nil
	}

	// 3. save in cache for reuse
	latestAssetsCacheMu.Lock()
	latestAssetsCache[room_id] = cachedResult{
		data:      Assets,
		expiresAt: time.Now().Add(cacheTTL),
	}
	latestAssetsCacheMu.Unlock()
	return Assets, nil
}

// CheckSimilarAsset checks if an asset with the given AssetCID already exists in the database.
// It returns true if the asset exists, false if it does not, and an error for any other database issue.
func (Repository *AssetRepo) CheckSimilarAsset(ctx context.Context, AssetCID string) (bool, error) {
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

func (repo *AssetRepo) UpdateAssetInfor(ctx context.Context, assetCID string, newInfo model.DetailUploadInfor) error {
	// 1. Load the existing asset
	var existing model.Asset
	err := repo.database.WithContext(ctx).
		Where("asset_cid = ?", assetCID).
		First(&existing).Error

	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return fmt.Errorf("asset with CID %s not found", assetCID)
		}
		return err
	}



	// 2. Calculate file size
	newFileSize := int64(len(newInfo.FileBuffer))

	// 3. Compare fields
	changes := map[string]interface{}{}
	if existing.AssetName != newInfo.Filename {
		changes["asset_name"] = newInfo.Filename
	}
	if existing.AssetMeshName != newInfo.MeshName {
		changes["asset_mesh_name"] = newInfo.MeshName
		
	}
	if existing.Title != newInfo.Title {
		changes["title"] = newInfo.Title
	}
	if existing.VietnameseDescription != newInfo.VietnameseDescription {
		changes["vietnamese_description"] = newInfo.VietnameseDescription
	}
	if existing.EnglishDescription != newInfo.EnglishDescription {
		changes["english_description"] = newInfo.EnglishDescription
	}
	if existing.RoomID != uint(newInfo.RoomID) {
		changes["room_id"] = uint(newInfo.RoomID)
	}
	if existing.Filesize != newFileSize {
		changes["filesize"] = newFileSize
	}

	// 4. If nothing is different → return without updating
	if len(changes) == 0 {
		return nil
	}

	// 5. Increment version
	changes["version"] = existing.Version + 1

	// 6. Apply update based on asset_cid
	if err := repo.database.WithContext(ctx).
		Model(&model.Asset{}).
		Where("asset_cid = ?", assetCID).
		Updates(changes).
		Error; err != nil {
		return fmt.Errorf("failed to update asset with CID %s: %v", assetCID, err)
	}

	return nil
}


