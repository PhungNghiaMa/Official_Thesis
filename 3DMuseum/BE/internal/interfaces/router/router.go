package api

import (
	services "main/internal/application/services"
	business "main/internal/infrastructure/business"
	databaseRepo "main/internal/infrastructure/persistence"
	websocket "main/internal/infrastructure/websocket"
	handler "main/internal/interfaces/api"
	multiplayer "main/internal/infrastructure/multiplayer"
	genai "main/internal/infrastructure/gen_ai"


	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)


func RegisterAssetRoutes(router *gin.Engine, database *gorm.DB, PinataAuth *business.PinataAuth, SFU *multiplayer.SFU) {
	assetRepository := databaseRepo.NewRepository(database)
	pinataRepository := business.NewPinataRepo(PinataAuth)
	ttsRepository := business.NewTTSRepo()
	imgConverRepository := business.NewImageConvertRepo()
	videoConvertRepository := business.NewHLSConvertRepo()

    // 1. Create the SINGLE Shared Hub
	sharedHub := websocket.NewWebSocketRepo() 

    // 2. Pass Shared Hub to Service
	assetService := services.NewService(assetRepository, pinataRepository, ttsRepository, sharedHub, imgConverRepository, videoConvertRepository)
	assetHandler := handler.NewHandler(assetService)

    // 3. Pass Shared Hub to WebSocket Handler
    wsHandler := handler.NewWebsocketHandler(sharedHub)

	assetRoutes := router.Group("/")
	{
		assetRoutes.GET("/hello", assetHandler.Hello)
		assetRoutes.POST("/upload", assetHandler.UploadAsset)
		assetRoutes.GET("/list/:roomID", assetHandler.GetAsset)
	}

    // 4. Use the new handler method
	router.GET("/ws", wsHandler.HandleWS) 
	router.POST("/join", SFU.HandleJoin)
}

func RegisterGenAIRoutes(router *gin.Engine, GenAIConfig *genai.GeminiClientConfig){
	genaiRepo := genai.NewGeminiRepo(GenAIConfig)
	genaiServices := services.NewGenAIServices(genaiRepo)
	genaiHandler := handler.NewGenAIHandler(genaiServices)

	genAIRoutes := router.Group("/")
	{
		genAIRoutes.POST("/generate_answer", genaiHandler.GenerateAnswer)
	}
}