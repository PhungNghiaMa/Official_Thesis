package api

import (
	services "main/internal/application/services"
	business "main/internal/infrastructure/business"
	databaseRepo "main/internal/infrastructure/persistence"
	websocket "main/internal/infrastructure/websocket"
	handler "main/internal/interfaces/api"
	multiplayer "main/internal/infrastructure/multiplayer"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)


func RegisterAssetRoutes(router *gin.Engine, database *gorm.DB, PinataAuth *business.PinataAuth, SFU *multiplayer.SFU) {
	assetRepository := databaseRepo.NewRepository(database)
	pinataRepository := business.NewPinataRepo(PinataAuth)
	ttsRepository := business.NewTTSRepo()
	imgConverRepository := business.NewImageConvertRepo()
	videoConvertRepository := business.NewHLSConvertRepo()
	websocketRepository := websocket.NewWebSocketRepo()
	assetService := services.NewService(assetRepository, pinataRepository, ttsRepository, websocketRepository, imgConverRepository, videoConvertRepository)
	assetHandler := handler.NewHandler(assetService)
	assetRoutes := router.Group("/")
	{
		assetRoutes.GET("/hello", assetHandler.Hello)
		assetRoutes.POST("/upload", assetHandler.UploadAsset)
		assetRoutes.GET("/list/:roomID", assetHandler.GetAsset)
	}
	router.GET("/ws", handler.HandleWS)
	router.POST("/join", SFU.HandleJoin)
}