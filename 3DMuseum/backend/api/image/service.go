package image

import (
	"context"
	"fmt"
	"main/business"
	"main/model"
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
	PinataUploadResponse, err := PinataService.UploadToPinata(DetailUploadInfor.FileBuffer, DetailUploadInfor.Filename)
	if err != nil {
		return err
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
