package assets

import (
	"context"
	"errors"
	"fmt"
	"main/business"
	"main/model"
	"sync"
	"time"

	"gorm.io/gorm"
)

type Repository interface {
	UpsertAsset(ctx context.Context, ktx2Resp model.AssetStruct, webpCID string, info model.DetailUploadInfor) error
	GetAsset(ctx context.Context, RoomID int) ([]model.ResponseMetadataInfor, error)
	InsertAudio(ctx context.Context, assetCID, language, description string) (*model.Audio, error)
	FindAudioByHash(ctx context.Context, textHash string, language string) (*model.Audio, error)
	UpdateAudio(ctx context.Context, assetCID string, language string, status, audioCID string, attempts int) error
	FetchPendingAudioJobs(ctx context.Context, limit int) ([]model.Audio, error)
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

// UpsertAssetWithFallback inserts or updates an asset with both KTX2 and WEBP fallback CIDs.
func (repo *AssetRepo) UpsertAsset(ctx context.Context, ktx2Resp model.AssetStruct, webpCID string, info model.DetailUploadInfor) error {
	tx := repo.database.WithContext(ctx).Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	var latestAsset model.Asset
	var currentVersion int = 0 // Start at 0 for the initial check

	// 1. Find the LATEST existing version for this mesh/room combination
	err := tx.Where("asset_mesh_name = ? AND room_id = ?", info.MeshName, info.RoomID).
		Order("version DESC").
		First(&latestAsset).Error

	// Check if an existing asset was found (could be version 1 or higher)
	if err == nil {
		// Record found, get its current version
		currentVersion = latestAsset.Version
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		// Handle actual database error
		tx.Rollback()
		return fmt.Errorf("database error during version check: %w", err)
	}

	fileSize := int64(len(info.FileBuffer))

	// 3. Decide whether to create a new row or stop (The core logic change)
	// We only create a new version (new row) if the CIDs have changed.

	// Check if we are updating an existing asset AND the CIDs are identical.
	// If the CIDs are identical AND we're updating, we skip the insert.
	if currentVersion > 0 &&
		latestAsset.AssetCID == ktx2Resp.IpfsHash {

		// CIDs are the same, but metadata (title/description) may have changed.
		// We update the metadata of the LATEST record (not the CID/version).
		// This is the simplest way to handle non-asset-changing updates.
		updates := map[string]any{
			"asset_name":             ktx2Resp.Filename,
			"title":                  info.Title,
			"vietnamese_description": info.VietnameseDescription,
			"english_description":    info.EnglishDescription,
			"filesize":               fileSize,
			"updated_at":             time.Now(),
		}

		// LOGIC TO FIX MISSING WebP CID:
		// Update the webp_cid if:
		// 1. The CIDs are DIFFERENT (user uploaded a new WebP fallback for the same KTX2).
		// 2. OR, if the old one was missing and the new one is present (fixing a previous fail).
		if latestAsset.WebpCID != webpCID {
			updates["webp_cid"] = webpCID
		}
		// Ensure that at least 1 field change then upgrad will be execute
		// else not do anything so we can save up resource to request to database and keep the system more consistent
		if len(updates) > 0 {
			if err := tx.Model(&model.Asset{}).Where("asset_id = ?", latestAsset.AID).Updates(updates).Error; err != nil {
				tx.Rollback()
				return fmt.Errorf("failed to update asset metadata and/or webp_cid: %w", err)
			}
		}
	} else {
		// Define new versin number for insert new row
		newVersion := currentVersion + 1

		// CIDs have changed OR it's a new asset (currentVersion == 0).
		// Create a new record with the incremented version.
		newAsset := model.Asset{
			AssetCID:              ktx2Resp.IpfsHash, // New KTX2 CID
			WebpCID:               webpCID,           // New WebP CID
			AssetMeshName:         info.MeshName,
			AssetName:             ktx2Resp.Filename,
			Title:                 info.Title,
			VietnameseDescription: info.VietnameseDescription,
			EnglishDescription:    info.EnglishDescription,
			RoomID:                uint(info.RoomID),
			Filesize:              fileSize,
			CategoryID:            uint(ktx2Resp.CategoryID),
			Version:               newVersion, // <-- This is the new, incremented version
		}
		if err := tx.Create(&newAsset).Error; err != nil {
			tx.Rollback()
			return fmt.Errorf("failed to create new asset version: %w", err)
		}
	}

	// 4. Commit the transaction
	if err := tx.Commit().Error; err != nil {
		return err
	}
	return nil
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
		WITH latest_assets AS (
			SELECT *,
				ROW_NUMBER() OVER (PARTITION BY asset_mesh_name ORDER BY version DESC) AS rn
			FROM assets
			WHERE room_id = ?
			),
			filtered_assets AS (
			SELECT * FROM latest_assets WHERE rn = 1
			)
			SELECT
			a.asset_mesh_name,
			a.asset_cid,
			a.webp_cid,
			a.title,
			a.vietnamese_description AS viet_des,
			a.english_description AS en_des,
			va.audio_cid AS viet_audio_cid,
			ea.audio_cid AS eng_audio_cid
			FROM filtered_assets AS a
			LEFT JOIN LATERAL (
			SELECT audio_cid
			FROM audios au
			WHERE au.asset_cid = a.asset_cid
				AND au.language = 'vi'
				AND au.status = 'completed'
			ORDER BY au.created_at DESC
			LIMIT 1
			) AS va ON TRUE
			LEFT JOIN LATERAL (
			SELECT audio_cid
			FROM audios au2
			WHERE au2.asset_cid = a.asset_cid
				AND au2.language = 'en'
				AND au2.status = 'completed'
			ORDER BY au2.created_at DESC
			LIMIT 1
			) AS ea ON TRUE;

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

func (repo *AssetRepo) InsertAudio(ctx context.Context, assetCID, language, description string) (*model.Audio, error) {
	textHash := business.HashTextSHA256(description)
	var existing model.Audio

	err := repo.database.WithContext(ctx).Where("asset_cid = ? AND language = ?", assetCID, language).First(&existing).Error
	// Case query execute succesfully without error
	if err == nil {
		return &existing, nil
	}
	// In case fail to find matching tuple with the input asset_cid and language
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	// Define tuple to insert into database
	tuple := model.Audio{
		AssetCID: assetCID,
		Language: language,
		TextHash: textHash,
		Status:   "Pending",
	}

	if err := repo.database.WithContext(ctx).Create(&tuple).Error; err != nil {
		return nil, err
	}
	return &tuple, nil
}

func (repo *AssetRepo) FindAudioByHash(ctx context.Context, textHash string, language string) (*model.Audio, error) {
	var tuple model.Audio
	err := repo.database.WithContext(ctx).Where("text_hash = ? AND language = ? AND audio_cid IS NOT NULL", textHash, language).First(&tuple).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	return &tuple, nil
}

func (repo *AssetRepo) UpdateAudio(ctx context.Context, assetCID string, language string, status, audioCID string, attempts int) error {
	changes := map[string]interface{}{
		"status":     status,
		"attempts":    attempts,
		"updated_at": time.Now(),
	}

	if audioCID != "" {
		changes["audio_cid"] = audioCID
	}
	return repo.database.WithContext(ctx).Model(&model.Audio{}).
		Where("asset_cid = ? AND language = ?", assetCID, language).
		Updates(changes).Error
}

// FetchPendingAudioJobs returns pending jobs for background workers
func (repo *AssetRepo) FetchPendingAudioJobs(ctx context.Context, limit int) ([]model.Audio, error) {
	var jobs []model.Audio
	err := repo.database.WithContext(ctx).Where("status = ?", "pending").Limit(limit).Find(&jobs).Error
	return jobs, err
}
