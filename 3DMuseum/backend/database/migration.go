package database

import (
	"fmt"
	"log"
	"main/model"

	"gorm.io/gorm"
)

// Migrate performs database schema migrations and seeds initial data.
func Migrate(db *gorm.DB) error {
	var modelsToMigrate = []interface{}{
		&model.Room{},    
		&model.Category{}, 
		&model.Asset{},    
	}

	for _, m := range modelsToMigrate {
		// GORM's AutoMigrate is smart enough to handle table existence.
		// No need for db.Migrator().HasTable(model) check here, AutoMigrate does it.
		if err := db.AutoMigrate(m); err != nil {
			return logFatalErrorf("FAILED TO AUTO-MIGRATE DATABASE SCHEMA for %T: %v", m, err)
		}
	}
	
	// 2. Seed initial Category data
	log.Println("Seeding initial category data...")
	// Use model.InitialAssetCategories which should be defined in your model package
	for _, categoryData := range Categories { // Iterate over the data to insert
		var existingCategory model.Category
		result := db.Where("category = ?", categoryData.Category).FirstOrCreate(&existingCategory, categoryData)

		if result.Error != nil {
			return logErrorf("Failed to seed category '%s': %v", categoryData.Category, result.Error)
		}

		if result.RowsAffected > 0 {
			log.Printf("Category '%s' (CID: %d) successfully inserted or found.", existingCategory.Category, existingCategory.CID)
		} else {
			log.Printf("Category '%s' (CID: %d) already exists.", existingCategory.Category, existingCategory.CID)
		}
	}

	for _, roomData := range Room{
		var existingRoom model.Room
		result := db.Where("room_name = ?", roomData.RoomName).FirstOrCreate(&existingRoom, roomData);

		if (result.Error != nil){
			log.Printf("Room '%s' (RID: %d) successfully inserted or found.", existingRoom.RoomName, existingRoom.RID)
		}else{
			log.Printf("Room '%s' (RID: %d) already exists.", existingRoom.RoomName, existingRoom.RID)
		}
	}	
	return nil
}

// logFatalErrorf is a helper function to log and terminate if a fatal error occurs.
func logFatalErrorf(format string, v ...interface{}) error {
	log.Fatalf(format, v...)
	return nil // Unreachable, but satisfies return type
}

// logErrorf is a helper function to log errors without terminating.
func logErrorf(format string, v ...interface{}) error {
	log.Printf("Error: "+format, v...)
	return fmt.Errorf(format, v...) // Return error for proper error handling upstream
}
