package model

type DetailUploadInfor struct {
	Filename              string `form:"-"` // Populated from file metadata, not a form field
	MeshName              string `form:"mesh_name"`
	Title                 string `form:"title"`
	VietnameseDescription string `form:"vietnamese_description"`
	EnglishDescription    string `form:"english_description"`
	RoomID                int    `form:"roomID"`
	FileBuffer            []byte `form:"-"` // Populated from file content, not a form field
}