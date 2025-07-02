package api

import (
	"main/api/image"
	"main/business"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func RegisterRoutes (router *gin.Engine , database *gorm.DB , PinataService *business.PinataService){
	image.RegisterAssetRoutes(router , database , PinataService)
}