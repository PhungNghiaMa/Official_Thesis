package database

import (
	"context"
	"log"
	"net"
	"net/url"
	"os"
	"strings"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func Connect() *gorm.DB {
	dsn := os.Getenv("DATABASE_URL")
	dsnFallback := os.Getenv("DATABASE_URL_IPv4")
	if dsn == "" {
		log.Fatal("DATABASE_URL environment variable is not set.")
	}
	if dsnFallback == "" {
		log.Println("Warning: DATABASE_URL_IPV4 is not set – IPv4 fallback will be skipped")
	}

	newLogger := logger.Default.LogMode(logger.Info)

	// Build a list of base DSNs to try, in order
	baseDSNs := []string{dsn}
	if dsnFallback != "" {
		baseDSNs = append(baseDSNs, dsnFallback)
	}

	var db *gorm.DB
	var lastErr error

	for _, baseDSN := range baseDSNs {
		log.Printf("Attempting connection using base DSN: %s", baseDSN)

		// Try the DSN directly first (no hostname replacement)
		if try, err := tryConnect(baseDSN, newLogger); err == nil {
			db = try
			goto success
		} else {
			lastErr = err
			log.Printf("Direct connection failed for DSN %s: %v", baseDSN, err)
		}

		// If direct connect on this DSN failed, try resolving its IPs (IPv6 and IPv4)
		parsedURL, err := url.Parse(baseDSN)
		if err != nil {
			log.Printf("Failed to parse DSN %s: %v", baseDSN, err)
			continue
		}
		hostname := strings.Split(parsedURL.Host, ":")[0]

		ips, err := net.LookupIP(hostname)
		if err != nil {
			log.Printf("Failed to resolve hostname %s: %v", hostname, err)
			continue
		}

		for _, ip := range ips {
			var newDSN string
			if ip.To4() != nil {
				newDSN = strings.Replace(baseDSN, hostname, ip.String(), 1)
			} else {
				newDSN = strings.Replace(baseDSN, hostname, "["+ip.String()+"]", 1)
			}
			log.Printf("Trying fallback DSN: %s", newDSN)

			if try, err := tryConnect(newDSN, newLogger); err == nil {
				db = try
				goto success
			} else {
				lastErr = err
				log.Printf("Connection failed for fallback DSN %s: %v", newDSN, err)
			}
		}
	}

	// no connection succeeded
	log.Fatalf("Failed to connect to Supabase PostgreSQL database after multiple attempts. Last error: %v", lastErr)
	return nil

success:
	// Configure pool and run migration
	sqlDB, err := db.DB()
	if err != nil {
		log.Fatalf("Failed to get sql.DB from gorm.DB: %v", err)
	}
	sqlDB.SetMaxOpenConns(10)
	sqlDB.SetMaxIdleConns(5)
	sqlDB.SetConnMaxLifetime(30 * time.Minute)

	log.Println("Successfully connected to Supabase PostgreSQL database!")

	if os.Getenv("RUN_MIGRATION") == "true" {
		log.Println("RUN_MIGRATION is true: running migration and seeding...")
		if err := Migrate(db); err != nil {
			log.Fatalf("Failed to migrate the schema: %v", err)
		}
	} else {
		log.Println("RUN_MIGRATION is not true: skipping migration and seeding.")
	}

	return db
}

// tryConnect attempts to open a connection and ping it.
// Returns (*gorm.DB, nil) on success, otherwise (nil, error).
func tryConnect(dsn string, logMode logger.Interface) (*gorm.DB, error) {
	done := make(chan struct{})
	var db *gorm.DB
	var err error

	go func() {
		db, err = gorm.Open(postgres.Open(dsn), &gorm.Config{
			Logger: logMode,
		})
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(10 * time.Second):
		return nil, context.DeadlineExceeded
	}

	if err != nil {
		return nil, err
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}

	pingCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := sqlDB.PingContext(pingCtx); err != nil {
		return nil, err
	}

	return db, nil
}
