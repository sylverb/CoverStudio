// mixes.js — built-in Skraper mix compositions (embedded from the original XML files).
// Keyed by the matching <select> value in index.html ("mix3" / "mix4" / "mix5").
export const BUILTIN_MIXES = {
  mix3: `<ImageComposition xsi:noNamespaceSchemaLocation="https://www.skraper.net/ImageComposition.xsd" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Information ShortName="Mix3 LD 4:3" LongName="3 Images Mix" Description="3DBox + Screenshot (or title screenshot) + Wheel" Author="Author" />
  <Viewport Color="#00FFFFFF" Width="800" Height="600" />
  <Drawings>
    <Item Type="Screenshot">
      <Display X="50%" Y="0%" Antialiasing="None" Width="90%" Height="90%" Anchor="TopHCenter" />
      <Fallback Type="ScreenshotTitle">
        <Fallback Type="SystemWallPaper">
          <Children Reference="Parent">
            <Item Type="Text" Text="No Screenshot!" TextColor="#FFFFFFFF" FontFamilly="Arial" FontStyle="Bold Italic" />
          </Children>
        </Fallback>
      </Fallback>
    </Item>
    <Item Type="Wheel">
      <Display X="100%" Y="100%" Width="50%" Height="33%" Anchor="BottomRight" />
      <Fallback Type="Text" Text="%name%" TextColor="#FFFFFFFF" FontFamilly="Arial" FontStyle="Bold Italic" />
    </Item>
    <Item Type="Box3D">
      <Display X="0%" Y="100%" Transparency="0.9" Width="45%" Height="60%" Anchor="BottomLeft" />
    </Item>
  </Drawings>
</ImageComposition>`,
  mix4: `<ImageComposition xsi:noNamespaceSchemaLocation="https://www.skraper.net/ImageComposition.xsd" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Information ShortName="Mix4 LD 4:3" LongName="4 Images Mix" Description="3DBox + Support + Screenshot (or title screenshot) + Wheel" Author="Author" />
  <Viewport Color="#00FFFFFF" Width="800" Height="600" />
  <Drawings>
    <Item Type="Screenshot">
      <Display X="50%" Y="0%" Antialiasing="None" Width="90%" Height="90%" Anchor="TopHCenter" />
      <Fallback Type="ScreenshotTitle">
        <Fallback Type="SystemWallPaper">
          <Children Reference="Parent">
            <Item Type="Text" Text="No Screenshot!" TextColor="#FFFFFFFF" FontFamilly="Arial" FontStyle="Bold Italic" />
          </Children>
        </Fallback>
      </Fallback>
    </Item>
    <Item Type="Wheel">
      <Display X="100%" Y="100%" Width="50%" Height="33%" Anchor="BottomRight" />
      <Fallback Type="Text" Text="%name%" TextColor="#FFFFFFFF" FontFamilly="Arial" FontStyle="Bold Italic" />
    </Item>
    <Item Type="NoResource">
      <Children>
        <Item IfOrientation="IsPortrait" Type="Box3D">
          <Display X="0%" Y="100%" Transparency="0.9" Width="45%" Height="60%" Anchor="BottomLeft" />
          <Children>
            <Item Type="Support">
              <Display X="20%" Y="95%" Transparency="0.9" Width="20%" Height="20%" Anchor="BottomLeft" />
            </Item>
          </Children>
        </Item>
        <Item IfOrientation="IsLandscape" Type="Box3D">
          <Display X="0%" Y="100%" Transparency="0.9" Width="45%" Height="60%" Anchor="BottomLeft" />
          <Children>
            <Item Type="Support">
              <Display X="5%" Y="70%" Transparency="0.9" Width="20%" Height="20%" Anchor="BottomLeft" />
            </Item>
          </Children>
        </Item>
      </Children>
    </Item>
  </Drawings>
</ImageComposition>`,
  mix5: `<ImageComposition xsi:noNamespaceSchemaLocation="https://www.skraper.net/ImageComposition.xsd" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Information ShortName="Mix5 LD 4:3" LongName="5 Images Mix" Description="3DBox + Support + Screenshot (or title screenshot) + Wheel + Regions" Author="Author" />
  <Viewport Color="#00FFFFFF" Width="800" Height="600" />
  <Drawings>
    <Item Type="Screenshot">
      <Display X="50%" Y="0%" Antialiasing="None" Width="90%" Height="90%" Anchor="TopHCenter" />
      <Fallback Type="ScreenshotTitle">
        <Fallback Type="SystemWallPaper">
          <Children Reference="Parent">
            <Item Type="Text" Text="No Screenshot!" TextColor="#FFFFFFFF" FontFamilly="Arial" FontStyle="Bold Italic" />
          </Children>
        </Fallback>
      </Fallback>
    </Item>
    <Item Type="Wheel">
      <Display X="100%" Y="100%" Width="50%" Height="33%" Anchor="BottomRight" />
      <Fallback Type="Text" Text="%name%" TextColor="#FFFFFFFF" FontFamilly="Arial" FontStyle="Bold Italic" />
    </Item>
    <Item Type="NoResource">
      <Children>
        <Item IfOrientation="IsPortrait" Type="Box3D">
          <Display X="0%" Y="100%" Transparency="0.9" Width="45%" Height="60%" Anchor="BottomLeft" />
          <Children>
            <Item Type="Support">
              <Display X="20%" Y="95%" Transparency="0.9" Width="20%" Height="20%" Anchor="BottomLeft" />
            </Item>
          </Children>
        </Item>
        <Item IfOrientation="IsLandscape" Type="Box3D">
          <Display X="0%" Y="100%" Transparency="0.9" Width="45%" Height="60%" Anchor="BottomLeft" />
          <Children>
            <Item Type="Support">
              <Display X="5%" Y="70%" Transparency="0.9" Width="20%" Height="20%" Anchor="BottomLeft" />
            </Item>
          </Children>
        </Item>
      </Children>
    </Item>
    <Item Type="NoResource">
      <Children>
        <Item Type="Region1">
          <Display X="100%" Y="0%" Width="15%" Height="15%" Anchor="TopRight" />
        </Item>
        <Item Type="Region2">
          <Display X="100%" Y="15%" Width="15%" Height="15%" Anchor="TopRight" />
        </Item>
      </Children>
    </Item>
  </Drawings>
</ImageComposition>`,
};
