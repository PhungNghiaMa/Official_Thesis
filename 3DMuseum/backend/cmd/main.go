package main

import (
	"fmt"
	"log"
	"main/api"
	"main/business"
	"main/database"
	"main/websocket"
	"os"
	"os/signal"
	"sync"
	"syscall"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

func init() {
	if err := godotenv.Load("../.env"); err != nil {
		log.Fatal("Warning: No .env found, or an error occured while loading .env file. Please check again !")
	} else {
		fmt.Println("Successfully load .env fle !")
	}
}

func main() {
	// fmt.Println("DATBASE_URL: ", os.Getenv("DATABASE_URL"))
	db := database.Connect()

	router := gin.Default()

	os.Setenv("STUN_URLS", "stun:stun.l.google.com:19302")
	// os.Setenv("TURN_URL", "turn:turn.example.com:3478")
	// os.Setenv("TURN_USER", "user")
	// os.Setenv("TURN_PASS", "pass")
	SFU := websocket.NewSFUServer()

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
	fmt.Println("PINATA_JWT: ", pinataJWT)
	fmt.Println("PINATA_GATEWAY_URL: ", pinataGatewayURL)

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
