package database

import (
	model "main/internal/domain"
)

var Categories = []model.Category{
	{Category: "Image"},
	{Category: "Video"},
	{Category: "Model"},
	{Category: "Audio"},
}

var Room = []model.Room{
	{RoomName: "Room1"},
	{RoomName: "Room2"},
}
