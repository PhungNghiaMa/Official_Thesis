package database

import (
	"context"
	"log"
	"os"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger" // Optional: for GORM SQL logging
)

func Connect() *gorm.DB {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("DATABASE_URL environment variable is not set.")
	}

	// GORM logger for better visibility into SQL queries
	newLogger := logger.Default.LogMode(logger.Info)

	// Open connection to the database with context timeout
	var database *gorm.DB
	var err error
	done := make(chan struct{})
	go func() {
		database, err = gorm.Open(postgres.Open(dsn), &gorm.Config{
			Logger: newLogger,
		})
		close(done)
	}()
	select {
	case <-done:
		// continue
	case <-time.After(10 * time.Second):
		log.Fatal("Timed out connecting to the database.")
	}
	if err != nil {
		log.Fatalf("Failed to connect to Supabase PostgreSQL database: %v", err)
	}

	// Set connection pool limits for stability
	sqlDB, err := database.DB()
	if err != nil {
		log.Fatalf("Failed to get sql.DB from gorm.DB: %v", err)
	}
	sqlDB.SetMaxOpenConns(10)
	sqlDB.SetMaxIdleConns(5)
	sqlDB.SetConnMaxLifetime(30 * time.Minute)

	// Ping DB to ensure connection is alive
	pingCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := sqlDB.PingContext(pingCtx); err != nil {
		log.Fatalf("Failed to ping database: %v", err)
	}

	log.Println("Successfully connected to Supabase PostgreSQL database!")
  
	// Log the database connection pool stats
	stats := sqlDB.Stats()
	log.Printf("Open connections: %d, In use: %d, Idle: %d, WaitCount: %d, MaxOpenConnections: %d",
		stats.OpenConnections, stats.InUse, stats.Idle, stats.WaitCount, stats.MaxOpenConnections)

	// Only run migration if RUN_MIGRATION=true in environment
	if os.Getenv("RUN_MIGRATION") == "true" {
		log.Println("RUN_MIGRATION is true: running migration and seeding...")
		err = Migrate(database)
		if err != nil {
			log.Fatalf("Failed to migrate the schema: %v", err)
		}
		// Optionally call your seeding function here if needed
		// err = Seed(database)
		// if err != nil {
		//     log.Fatalf("Failed to seed the database: %v", err)
		// }
	} else {
		log.Println("RUN_MIGRATION is not true: skipping migration and seeding.")
	}
	return database
}
