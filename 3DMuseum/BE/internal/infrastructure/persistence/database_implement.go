package database

import (
	"context"
	"errors"
	"fmt"
	applicationDTO "main/internal/application/dto"
	model "main/internal/domain"
	business "main/internal/infrastructure/business"
	"sync"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

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
func (repo *AssetRepo) UpsertAsset(ctx context.Context, ktx2Resp applicationDTO.AssetStruct, webpCID string, info model.DetailUploadInfor) error {
	tx := repo.database.WithContext(ctx).Begin()
	// Ensure rollback occurs if an error or panic happens
	defer tx.Rollback()

	var latestAsset model.Asset
	var currentVersion int = 0
	var newWebpCID *string
	if webpCID != "" {
		newWebpCID = &webpCID
	} else {
		newWebpCID = nil
	}

	// =========================================================================
	// STEP 1: CHECK IF THE ASSET (CID) IS CURRENTLY IN USE AS THE LATEST VERSION BY ANY MESH
	// =========================================================================
	var conflictAsset model.Asset
	// Find if this CID is the latest version for any mesh-room
	errCheck := tx.Raw(`
		SELECT * FROM (
			SELECT *,
				ROW_NUMBER() OVER (PARTITION BY asset_mesh_name, room_id ORDER BY version DESC) AS rn
			FROM assets
		) t
		WHERE t.rn = 1 AND t.asset_cid = ?
		LIMIT 1
	`, ktx2Resp.IpfsHash).Scan(&conflictAsset).Error



	// =========================================================================
	// STEP 2: RETRIEVE CURRENT VERSION INFORMATION FOR THE MESH BEING PROCESSED
	// =========================================================================
	err := tx.Where("asset_mesh_name = ? AND room_id = ?", info.MeshName, info.RoomID).
		Order("version DESC").
		First(&latestAsset).Error

	if err == nil {
		currentVersion = latestAsset.Version
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return fmt.Errorf("error querying mesh version: %w", err)
	}

	// In the case the CID is holding by an asset_mesh as the latest verion , then check and allow the 
	// admin that can only update 
	// Else if the CID is not the latest verson of any assest_mesh then allow the admin to reuse this CID for the new asset_mesh by update
	// the information like new title , new description , new name , new asset_mesh , new version for the asset_mesh that will
	// use this CID 
	if errCheck == nil && conflictAsset.AssetCID != ""  {
		// Check if the CID exist in database or not 
		// If this asset is the latest version for another mesh-room
		// (Except for the case where that mesh is the current one being uploaded)
		if conflictAsset.AssetMeshName != info.MeshName || conflictAsset.RoomID != uint(info.RoomID) {
			return fmt.Errorf("Asset (CID: %s) is currently in use as the latest version by mesh '%s' in room %d. Duplicate upload is not allowed.",
				ktx2Resp.IpfsHash, conflictAsset.AssetMeshName, conflictAsset.RoomID)
		}
	}else if errCheck == nil && conflictAsset.AssetCID == ""{
		var count int64
		tx.Model(&model.Asset{}).Where("asset_cid = ?", ktx2Resp.IpfsHash).Count(&count)
		if (count > 0){
			updates := map[string]any{
				"asset_mesh_name": info.MeshName,
				"asset_name":            ktx2Resp.Filename,
				"title":                 info.Title,
				"vietnamese_description": info.VietnameseDescription,
				"english_description":    info.EnglishDescription,
				"updated_at":            time.Now(),
				"version": currentVersion + 1,
			}

			// Safe comparison of WebpCID to avoid panic
			isWebpChanged := false
			if (latestAsset.WebpCID == nil && newWebpCID != nil) || 
			(latestAsset.WebpCID != nil && newWebpCID == nil) ||
			(latestAsset.WebpCID != nil && newWebpCID != nil && *latestAsset.WebpCID != *newWebpCID) {
				isWebpChanged = true
			}

			if isWebpChanged {
				updates["webp_cid"] = newWebpCID
			}

			if err := tx.Model(&model.Asset{}).Where("asset_cid = ?", ktx2Resp.IpfsHash).Updates(updates).Error; err != nil {
				return fmt.Errorf("failed to update metadata: %w", err)
			}
			// Sync Audio records for existing asset
			if err := repo.syncAudioRecords(tx, ktx2Resp.IpfsHash, info); err != nil {
				return err
			}
			return tx.Commit().Error
		}
	}

	fileSize := int64(len(info.FileBuffer))

	// =========================================================================
	// STEP 3: PROCEED WITH UPDATE OR INSERT
	// =========================================================================
	
	// Case 1: Mesh already has data and new CID matches old CID -> Only update metadata
	if currentVersion > 0 && latestAsset.AssetCID == ktx2Resp.IpfsHash {
		updates := map[string]any{
			"asset_name":            ktx2Resp.Filename,
			"title":                 info.Title,
			"vietnamese_description": info.VietnameseDescription,
			"english_description":    info.EnglishDescription,
			"filesize":               fileSize,
			"updated_at":            time.Now(),
		}

		// Safe comparison of WebpCID to avoid panic
		isWebpChanged := false
		if (latestAsset.WebpCID == nil && newWebpCID != nil) || 
		   (latestAsset.WebpCID != nil && newWebpCID == nil) ||
		   (latestAsset.WebpCID != nil && newWebpCID != nil && *latestAsset.WebpCID != *newWebpCID) {
			isWebpChanged = true
		}

		if isWebpChanged {
			updates["webp_cid"] = newWebpCID
		}

		if err := tx.Model(&model.Asset{}).Where("asset_id = ?", latestAsset.AID).Updates(updates).Error; err != nil {
			return fmt.Errorf("failed to update metadata: %w", err)
		}

	} else {
		// Case 2 & 3: Mesh is empty (currentVersion=0) OR new CID differs from old CID 
		// -> Create a new record with incremented version
		newVersion := currentVersion + 1
		
		newAsset := model.Asset{
			AssetCID:              ktx2Resp.IpfsHash,
			WebpCID:               newWebpCID,
			AssetMeshName:         info.MeshName,
			AssetName:             ktx2Resp.Filename,
			Title:                 info.Title,
			VietnameseDescription: info.VietnameseDescription,
			EnglishDescription:    info.EnglishDescription,
			RoomID:                uint(info.RoomID),
			Filesize:              fileSize,
			CategoryID:            uint(ktx2Resp.CategoryID),
			Version:               newVersion,
		}

		if err := tx.Create(&newAsset).Error; err != nil {
			return fmt.Errorf("failed to create new asset version: %w", err)
		}
	}

	// End Transaction
	return tx.Commit().Error
}

func (Repository *AssetRepo) GetAsset(ctx context.Context, RoomID int) ([]model.ResponseMetadataInfor, error) {

	// 1. check cache
	latestAssetsCacheMu.RLock()
	room_id := uint(RoomID)
	entry, found := latestAssetsCache[room_id]
	latestAssetsCacheMu.RUnlock()

	// Acquires a read lock on latestAssetsCacheMu.
	// Checks if there’s a cached entry for room_id and whether it hasn’t expired.
	// If valid: returns cached []model.ResponseMetadataInfor immediately (no DB hit).
	// If missing/expired: proceeds to query the database.
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
			a.vietnamese_description AS vietnamese_description,
			a.english_description AS english_description,
			c.category AS category,  
			va.audio_cid AS viet_audio_cid,
			ea.audio_cid AS eng_audio_cid
		FROM filtered_assets AS a
		JOIN categories c ON c.category_id = a.category_id   
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
	// Cache write (slow path):
	// Acquires a write lock.
	// Stores the fetched Assets along with an expiration time (time.Now().Add(cacheTTL)).
	// Releases the lock.
	latestAssetsCacheMu.Lock()
	latestAssetsCache[room_id] = cachedResult{
		data:      Assets,
		expiresAt: time.Now().Add(cacheTTL),
	}
	latestAssetsCacheMu.Unlock()
	return Assets, nil
}

// InsertAudio inserts a new audio record or returns the existing one if it already exists.
func (repo *AssetRepo) InsertAudio(ctx context.Context, assetCID, language, description string) (*model.Audio, error) {
	textHash := business.HashTextSHA256(description)
	var existing model.Audio

	err := repo.database.WithContext(ctx).Where("asset_cid = ? AND language = ?", assetCID, language).First(&existing).Error
	// Case query execute succesfully without error
	// This if block is to handle the case where the audio record already exists
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
		"attempts":   attempts,
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

// Helper to create/check audio jobs for both languages
func (repo *AssetRepo) syncAudioRecords(tx *gorm.DB, assetCID string, info model.DetailUploadInfor) error {
    languages := []struct {
        code string
        text string
    }{
        {"vi", info.VietnameseDescription},
        {"en", info.EnglishDescription},
    }

    for _, lang := range languages {
        if lang.text == "" {
            continue
        }

        textHash := business.HashTextSHA256(lang.text)
        
        // Check if this specific text/lang combo already has a generated audio (FindAudioByHash)
        var existingAudio model.Audio
        err := tx.Where("text_hash = ? AND language = ? AND audio_cid IS NOT NULL", textHash, lang.code).
            First(&existingAudio).Error

        status := "pending"
        var audioCID *string = nil

        // If we found an existing audio with the SAME text hash, reuse its CID
        if err == nil {
            status = "completed"
            audioCID = &existingAudio.AudioCID
        }

        // Use UPSERT logic for the audio table
        // This ensures if a job for (assetCID, lang) exists, we update it; otherwise, insert.
        audioEntry := model.Audio{
            AssetCID: assetCID,
            Language: lang.code,
            TextHash: textHash,
            Status:   status,
            // AudioCID will be nil if status is pending, or the reused CID if completed
        }
        if audioCID != nil {
            audioEntry.AudioCID = *audioCID
        }

        // Using GORM OnConflict to handle the "Insert or Update" for the audio table
        err = tx.Clauses(clause.OnConflict{
            Columns:   []clause.Column{{Name: "asset_cid"}, {Name: "language"}},
            DoUpdates: clause.AssignmentColumns([]string{"text_hash", "status", "audio_cid", "updated_at"}),
        }).Create(&audioEntry).Error

        if err != nil {
            return fmt.Errorf("failed to sync audio for %s: %w", lang.code, err)
        }
    }
    return nil
}