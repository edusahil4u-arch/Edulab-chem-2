package com.valencelab.chem

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.valencelab.chem.ui.ValenceLabApp
import com.valencelab.chem.ui.ValenceLabTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            ValenceLabTheme {
                ValenceLabApp()
            }
        }
    }
}
