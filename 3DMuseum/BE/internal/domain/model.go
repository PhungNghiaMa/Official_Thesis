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
	AID      uint   `gorm:"column:asset_id;primaryKey;autoIncrement" json:"aid"`
	AssetCID string `gorm:"column:asset_cid;type:varchar(255);unique;not null" json:"asset_cid"`
	WebpCID  *string `gorm:"column:webp_cid;type:varchar(255);unique" json:"webp_cid"` // fallback webp image , pointer string allow the database accept the &"" and insert it as null

	AssetMeshName         string `gorm:"type:varchar(255);index:idx_assets_room_mesh_version,priority:2" json:"asset_mesh_name"`
	AssetName             string `gorm:"type:varchar(255);not null" json:"asset_name"`
	Title                 string `gorm:"type:varchar(255)" json:"title"`
	VietnameseDescription string `gorm:"type:text" json:"vietnamese_description"`
	EnglishDescription    string `gorm:"type:text" json:"english_description"`

	// Foreign Key to Room (One-to-Many)
	RoomID uint `gorm:"not null;index:idx_assets_room_mesh_version,priority:1" json:"room_id"`
	Room   Room `gorm:"foreignKey:RoomID"`

	// Foreign Key to Category (One-to-Many)
	CategoryID uint     `gorm:"not null;index" json:"category_id"`
	Category   Category `gorm:"foreignKey:CategoryID"`
	Filesize   int64
	Version    int       `gorm:"default:1;index:idx_assets_room_mesh_version,priority:3,sort:desc" json:"version"`
	CreatedAt  time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt  time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

type Audio struct {
	AudioID   uint      `gorm:"column:audio_id;primaryKey;autoIncrement" json:"auid"`
	AssetCID  string    `gorm:"column:asset_cid;type:varchar(255);not null;index:idx_audio_lookup,priority:1" json:"asset_cid"`
	Asset   Asset     `gorm:"foreignKey:AssetCID;references:AssetCID"`
	Language  string    `gorm:"column:language;type:varchar(50);not null;index:idx_audio_lookup,priority:2" json:"language"`
	TextHash  string    `gorm:"column:text_hash;type:varchar(255);not null" json:"text_hash"`
	AudioCID  string    `gorm:"column:audio_cid;type:varchar(255)" json:"audio_cid"`
	Status    string    `gorm:"column:status;type:varchar(20);default:'pending';index:idx_audio_lookup,priority:3" json:"status"`
	Attempts  int       `gorm:"column:attempts;default:0" json:"attempts"`
	Duration  int64     `gorm:"column:duration_ms;default:0" json:"duration_ms"`
	CreatedAt time.Time `gorm:"column:created_at;autoCreateTime;index:idx_audio_lookup,priority:4,sort:desc" json:"created_at"`
	UpdatedAt time.Time `gorm:"column:updated_at;autoUpdateTime" json:"updated_at"`
}
