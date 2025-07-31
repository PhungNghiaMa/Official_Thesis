package image

import (
	"context"
	"fmt"
	"main/business"
	"main/model"
	"os"
	"path/filepath"
	"time"
)

var ErrorAssetExist error

type Service interface {
	UploadAsset(Context context.Context, DetailUploadInfor model.DetailUploadInfor, PinataService *business.PinataService) error
	GetAsset(Context context.Context, RoomID int) ([]model.ResponseMetadataInfor, error)
}

type ImageService struct {
	ImageRepo Repository
}

func NewService(ImageRepo Repository) *ImageService {
	return &ImageService{ImageRepo: ImageRepo}
}

func (ImageService *ImageService) UploadAsset(context context.Context, DetailUploadInfor model.DetailUploadInfor, PinataService *business.PinataService) error {
	var fileBuffer []byte
	var newFileName string
	// -STEP 1: Save the original uploaded file to a temporary location
	tempFileName := fmt.Sprintf("%d-%s", time.Now().UnixNano(), filepath.Base(DetailUploadInfor.Filename))
	tempFilePath := filepath.Join(os.TempDir(), tempFileName)

	err := os.WriteFile(tempFilePath, DetailUploadInfor.FileBuffer, 0644) // Write the buffer to a temp file
	if err != nil {
		return fmt.Errorf("failed to save original file to temporary path: %w", err)
	}
	// Defer deletion of the temporary original file. This ensures cleanup even if errors occur.
	defer func() {
		if rErr := os.Remove(tempFilePath); rErr != nil {
			fmt.Printf("Warning: Failed to remove temporary file %s: %v\n", tempFilePath, rErr)
		}
	}()

	// -STEP 2: Convert the image to KTX2 format and WebP 
	if fileBuffer, newFileName, err = business.ConvertToKTX2(tempFilePath) ; err != nil {
		
	}

	PinataUploadResponse, err := PinataService.UploadToPinata(fileBuffer, newFileName)
	if err != nil {
		return err
	}
	if PinataUploadResponse.IpfsHash == "" {
		fmt.Println("CANNOT GET THE IPFS_HASH")
	} else {
		fmt.Println("IPFS_HASH: ", PinataUploadResponse.IpfsHash)
	}

	ErrorAssetExist = fmt.Errorf("asset already exists at the Mesh %v in the Room %v", DetailUploadInfor.MeshName, DetailUploadInfor.RoomID)
	exists, err := ImageService.ImageRepo.CheckSimilarAsset(context, PinataUploadResponse.IpfsHash)
	if err != nil {
		return err
	}
	if exists {
		return ErrorAssetExist
	}

	// If there is no error and the image is not exist in any room then try to insert into the database
	return ImageService.ImageRepo.UploadAsset(context, PinataUploadResponse, DetailUploadInfor)
}

func (ImageService *ImageService) GetAsset(context context.Context, RoomID int) ([]model.ResponseMetadataInfor, error) {
	assetList, err := ImageService.ImageRepo.GetAsset(context, RoomID)
	return assetList, err
}
