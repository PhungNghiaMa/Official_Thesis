package model 

type ResponseMetadataInfor struct {
	AssetMeshName int `json:"asset_mesh_name"`
	Asset_CID string `json:"asset_cid"`
	Title string `json:"title"`
	VietnameseDescription string `json:"viet_des"`
	EnglishDescription string `json:"en_des"`
}