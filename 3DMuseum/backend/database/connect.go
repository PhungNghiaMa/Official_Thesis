package database

import (
	"log"
	"os"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger" // Optional: for GORM SQL logging
)

func Connect() *gorm.DB {
	dsn := os.Getenv("DATABASE_URL") // Recommended way
	if dsn == "" {
		log.Fatal("DATABASE_URL environment variable is not set.")
	}

    // Optional: GORM logger for better visibility into SQL queries
    newLogger := logger.Default.LogMode(logger.Info)

	// Open connection to the database
	database, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		// PrepareStmt: true, // Typically enabled by default and preferred for performance
        // Set up the logger
        Logger: newLogger,
	})

	if err != nil {
		log.Fatalf("Failed to connect to Supabase PostgreSQL database: %v", err)
	}

	log.Println("Successfully connected to Supabase PostgreSQL database!")

	// Update the DB schema based on the struct in model/model.go
	err = Migrate(database) // Calls Migrate
	if err != nil {
		log.Fatalf("Failed to migrate the schema: %v", err)
	}
	return database
}

