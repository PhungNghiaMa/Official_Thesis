package main

import (
	"fmt"
	"log"
	api "main/internal/interfaces"
	business "main/internal/infrastructure/business"
	database "main/internal/infrastructure/persistence"
	multiplayer "main/internal/infrastructure/multiplayer"
	"os"
	"os/signal"
	"sync"
	"syscall"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

func init() {
	if err := godotenv.Load("../../.env"); err != nil {
		log.Fatal("Warning: No .env found, or an error occured while loading .env file. Please check again !")
	} else {
		fmt.Println("Successfully load .env fle !")
	}
}

func main() {
	// fmt.Println("DATBASE_URL: ", os.Getenv("DATABASE_URL"))
	db := database.Connect()

	router := gin.Default()

	// === Load SFU configuration from config.toml ===
	sfuCfg, err := multiplayer.LoadSFUConfig("../../config.toml")
	if err != nil {
		log.Println("[SFU] Warning: using default STUN server because config.toml not found:", err)
		// Fallback default
		sfuCfg = &multiplayer.SFUConfig{
			RTC: multiplayer.RTCConfig{
				ICEServers: multiplayer.ICEConfig{
					Servers: []multiplayer.ICEServer{
						{URLs: []string{"stun:stun.l.google.com:19302"}},
					},
				},
			},
		}
	}

	// create SFU server (reads STUN/TURN from env in your websocket package)
	SFU := multiplayer.NewSFURepo(sfuCfg)

	// CONFIG CORS middleware
	CORS := cors.DefaultConfig()
	FRONTEND_URL := os.Getenv("FRONTEND_TEST_URL")
	if FRONTEND_URL == "" {
		fmt.Println("Fail to load Frontend URL environment !")
		return
	}

	// ALLOW REQUEST FROM FRONTEND
	CORS.AllowOrigins = []string{FRONTEND_URL}

	// ALLOW COMMONS HEADER
	CORS.AllowHeaders = []string{"Origin", "Content-Type", "Authorization", "Accept", "User-Agent", "Cache-Control", "Pragma"}
	// Allow common methods (GET, POST, PUT, DELETE, PATCH, OPTIONS)
	CORS.AllowMethods = []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"}
	// If you use cookies or authorization headers that require credentials
	CORS.AllowCredentials = true

	router.Use(cors.New(CORS))

	pinataJWT := os.Getenv("PINATA_JWT")
	pinataGatewayURL := os.Getenv("PINATA_GATEWAY_URL")
	PinataService := business.NewPinataService(pinataJWT, pinataGatewayURL)

	api.RegisterRoutes(router, db, PinataService, SFU)

	go func() {
		if err := router.Run(":3001"); err != nil {
			// Use log.Fatal to stop the program if the server fails to start
			log.Fatalf("Server failed to run on port 3001: %v", err)
		}
	}()

	// graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt, syscall.SIGTERM)
	<-quit

	var wg sync.WaitGroup
	wg.Add(1)
	// shutdown SFU
	go func() {
		SFU.CloseAll()
		defer wg.Done()
	}()
	wg.Wait()
}
