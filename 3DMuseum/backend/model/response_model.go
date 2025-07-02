package model
type ResponseMetadataInfor struct {
    AssetMeshName         string `json:"asset_mesh_name" gorm:"column:asset_mesh_name"`
    AssetCID              string `json:"asset_cid" gorm:"column:asset_cid"`
    Title                 string `json:"title" gorm:"column:title"`
    VietnameseDescription string `json:"viet_des" gorm:"column:vietnamese_description"`
    EnglishDescription    string `json:"en_des" gorm:"column:english_description"`
}