package image

import (
	"errors"
	"fmt"
	"io"
	"main/business"
	"main/model"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

type Handler struct {
	ImageService  Service
	PinataService *business.PinataService
}

func NewHandler(ImageService Service, PinataService *business.PinataService) *Handler {
	return &Handler{ImageService: ImageService, PinataService: PinataService}
}

func (Handler *Handler) UploadAsset(context *gin.Context) {
	var input model.DetailUploadInfor

	// For multipart/form-data, you must bind the form fields, not JSON.
	// The `form` tags in your struct will be used here.
	if err := context.ShouldBind(&input); err != nil {
		context.JSON(http.StatusBadRequest, gin.H{"error": "Invalid form data: " + err.Error(), "success": false})
		return
	}

	// Retrieve the uploaded file from the form-data
	fileHeader, err := context.FormFile("file") // "file" is the field name from the frontend
	if err != nil {
		context.JSON(http.StatusBadRequest, gin.H{"error": "File is required: " + err.Error(), "success": false})
		return
	}

	// The Filename field of fileHeader contains the original filename, including the extension.
	// e.g., "my-awesome-model.glb". This is where you populate your struct's Filename.
	input.Filename = fileHeader.Filename

	// Open the file to read its contents
	file, err := fileHeader.Open()
	if err != nil {
		context.JSON(http.StatusInternalServerError, gin.H{"error": "Unable to open uploaded file: " + err.Error(), "success": false})
		return
	}
	defer file.Close()

	// Read the file content into a byte buffer to populate your struct's FileBuffer
	buffer, err := io.ReadAll(file)
	if err != nil {
		context.JSON(http.StatusInternalServerError, gin.H{"error": "Unable to read file content: " + err.Error() , "success": false})
		return
	}
	input.FileBuffer = buffer


	// Now the 'input' struct is fully populated and can be passed to the service layer.
	if err := Handler.ImageService.UploadAsset(context.Request.Context(), input, Handler.PinataService); err != nil {
		if errors.Is(err, ErrorAssetExist){
			context.JSON(http.StatusConflict, gin.H{"error": err.Error(), "success": false})
			return	
		}
		context.JSON(http.StatusInternalServerError, gin.H{"error": err.Error(), "success": false})
		return
	}

	context.JSON(http.StatusOK, gin.H{"message": "Upload asset successfully !", "success": true})
}

func (Handler *Handler) GetAsset(context *gin.Context) {
	var assetList []model.ResponseMetadataInfor
	roomIDStr := context.Param("roomID")
	roomID, err := strconv.ParseInt(roomIDStr, 10, 32)
	fmt.Println("RoomID: ", roomID)
	if err != nil {
		context.JSON(http.StatusBadRequest, gin.H{"error": "Invalid roomID"})
		return
	}

	assetList, err = Handler.ImageService.GetAsset(context.Request.Context(), int(roomID))
	if err != nil {
		context.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if assetList == nil {
		context.JSON(http.StatusOK, gin.H{"message": "No data for asset found in database !"})
		return
	}

	context.JSON(http.StatusOK, assetList)
}
