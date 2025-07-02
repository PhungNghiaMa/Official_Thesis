package model

import (
	"time"
)

// Room ( RID , RoomName )
type Room struct {
	RID      uint    `gorm:"column:room_id;primaryKey;autoIncrement" json:"rid"`
	RoomName string  `gorm:"type:varchar(255);unique;not null" json:"room_name"`
	Assets   []Asset `gorm:"foreignKey:RoomID"` // One-to-Many: Room → Assets
}

// Category ( CID , Category )
type Category struct {
	CID      uint    `gorm:"column:category_id;primaryKey;autoIncrement" json:"cid"`
	Category string  `gorm:"column:category;type:varchar(50);unique;not null" json:"category"`
	Assets   []Asset `gorm:"foreignKey:CategoryID"` // One-to-Many: Category → Assets
}

// Asset ( AID , Asset_CID , AssetMeshName ,  AssetName , Title, Descriptions, Timestamps, Foreign Keys )
type Asset struct {
	AID                   uint      `gorm:"column:asset_id;primaryKey;autoIncrement" json:"aid"`
	AssetCID              string    `gorm:"column:asset_cid;type:varchar(255);unique;not null" json:"asset_cid"`
	AssetMeshName 		  string    `gorm:"type:varchar(255)" json:"asset_mesh_name"` 
	AssetName             string    `gorm:"type:varchar(255);not null" json:"asset_name"`
	Title                 string    `gorm:"type:varchar(255)" json:"title"`
	VietnameseDescription string    `gorm:"type:text" json:"vietnamese_description"`
	EnglishDescription    string    `gorm:"type:text" json:"english_description"`

	// Foreign Key to Room (One-to-Many)
	RoomID uint `gorm:"not null;index" json:"room_id"`
	Room   Room `gorm:"foreignKey:RoomID"`

	// Foreign Key to Category (One-to-Many)
	CategoryID uint     `gorm:"not null;index" json:"category_id"`
	Category   Category `gorm:"foreignKey:CategoryID"`
	Filesize int64 
	CreatedAt             time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt             time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}




