package main

import (
	"fmt"
	"log"
	"main/api"
	"main/business"
	"main/database"
	"os"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/gin-contrib/cors"
)

func init(){
	if err := godotenv.Load("../.env") ; err != nil {
		log.Fatal("Warning: No .env found, or an error occured while loading .env file. Please check again !")
	}else{
		fmt.Println("Successfully load .env fle !")
	}
}

func main() {
	fmt.Println("DATBASE_URL: ", os.Getenv("DATABASE_URL"))
	db := database.Connect()

	router := gin.Default()

	// CONFIG CORS middleware
	CORS := cors.DefaultConfig()
	FRONTEND_URL := os.Getenv("FRONTEND_TEST_URL")
	if (FRONTEND_URL == ""){
		fmt.Println("Fail to load Frontend URL environment !")
		return;
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

	PinataService := business.NewPinatService(pinataJWT, pinataGatewayURL)

	api.RegisterRoutes(router, db, PinataService)
	router.Run(":3001")
}
