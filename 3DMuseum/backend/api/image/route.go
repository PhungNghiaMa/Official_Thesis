package image

import (
	"fmt"
	"main/business"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func RegisterAssetRoutes(router *gin.Engine , database *gorm.DB, PinataService *business.PinataService){
		assetRepository := NewRepository(database)
		assetService := NewService(assetRepository)
		// You need to create or obtain a business.PinataService instance, e.g.:
		assetHandler := NewHandler(assetService, PinataService)

		assetRoutes := router.Group("/")
		{
			assetRoutes.GET("/hello", func(ctx *gin.Context) {fmt.Println("Hello")})	
			assetRoutes.POST("/upload", assetHandler.UploadAsset)
			assetRoutes.GET("/list/:roomID", assetHandler.GetAsset)
		}
}