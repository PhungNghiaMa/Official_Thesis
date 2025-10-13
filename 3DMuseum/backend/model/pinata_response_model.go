package model

type AssetStruct struct {
	Filename string
	IpfsHash string // Asset_CID
	CategoryID int
}

type AudioStruct struct{
	IpfsHash string `json:"IPFSHash"` // AudioCID
}