package api

import (
	"main/api/assets"
	"main/business"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func RegisterRoutes (router *gin.Engine , database *gorm.DB , PinataService *business.PinataService){
	assets.RegisterAssetRoutes(router , database , PinataService)
}