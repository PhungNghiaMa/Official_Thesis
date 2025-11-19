package api

import (
	"main/api/assets"
	"main/business"
	"main/websocket"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func RegisterAssetRoutes(router *gin.Engine, database *gorm.DB, PinataService *business.PinataService, SFU *websocket.SFU) {
	assetRepository := assets.NewRepository(database)
	pinataRepository := business.NewPinataRepo(PinataService)
	ttsRepository := business.NewTTSRepo()
	assetService := assets.NewService(assetRepository, pinataRepository, ttsRepository)
	assetHandler := assets.NewHandler(assetService)

	assetRoutes := router.Group("/")
	{
		assetRoutes.GET("/hello", assetHandler.Hello)
		assetRoutes.POST("/upload", assetHandler.UploadAsset)
		assetRoutes.GET("/list/:roomID", assetHandler.GetAsset)
	}
	router.GET("/ws", websocket.HandleWS)
	router.POST("/join", SFU.HandleJoin)
}
