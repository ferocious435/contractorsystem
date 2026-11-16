using System;
using System.IO;
using System.Linq;
using Autodesk.AutoCAD.Runtime;
using Autodesk.AutoCAD.ApplicationServices;
using Autodesk.AutoCAD.DatabaseServices;
using Autodesk.AutoCAD.Geometry;
using Autodesk.AutoCAD.PlottingServices;
public class DenyFiles:HostApplicationServices {
 public override string FindFile(string s,Database d,FindFileHint h){return null;}
 public override string GetRemoteFile(Uri u,bool c){throw new InvalidOperationException();}
 public override void PutRemoteFile(Uri u,string f){throw new InvalidOperationException();}
}
public class PlotProbe {
 private Transaction st,dt;private BlockTableRecord dest;private int copied,skipped;private System.Collections.Generic.Dictionary<string,int> omitted=new System.Collections.Generic.Dictionary<string,int>();
 private void Skip(string k){skipped++;if(!omitted.ContainsKey(k))omitted[k]=0;omitted[k]++;}
 private void Walk(BlockTableRecord b,Matrix3d transform,System.Collections.Generic.HashSet<ObjectId> stack,int depth){
  if(depth>24||!stack.Add(b.ObjectId)){Skip("BLOCK_CYCLE_OR_DEPTH");return;}
  foreach(ObjectId id in b){try{
   var e=st.GetObject(id,OpenMode.ForRead,false) as Entity;if(e==null){Skip("Unknown");continue;}
   var layer=st.GetObject(e.LayerId,OpenMode.ForRead) as LayerTableRecord;
   if(!e.Visible||layer==null||layer.IsOff||layer.IsFrozen||!layer.IsPlottable)continue;
   var br=e as BlockReference;
   if(br!=null){var child=st.GetObject(br.BlockTableRecord,OpenMode.ForRead) as BlockTableRecord;
    if(child==null||child.IsFromExternalReference||child.IsFromOverlayReference||br.IsDynamicBlock){Skip("BLOCK_EXTERNAL_DYNAMIC_OR_UNKNOWN");continue;}
    foreach(ObjectId aid in br.AttributeCollection){
     var att=st.GetObject(aid,OpenMode.ForRead,false) as AttributeReference;if(att==null){Skip("BLOCK_ATTRIBUTE_UNREADABLE");continue;}
     if(att.Invisible||!att.Visible)continue;
     var al=st.GetObject(att.LayerId,OpenMode.ForRead) as LayerTableRecord;if(al==null||al.IsOff||al.IsFrozen||!al.IsPlottable)continue;
     try{var text=new DBText();text.Position=att.Position;text.TextString=att.TextString;text.Height=att.Height;text.Rotation=att.Rotation;text.TransformBy(transform);dest.AppendEntity(text);dt.AddNewlyCreatedDBObject(text,true);copied++;}catch(System.Exception){Skip("BLOCK_ATTRIBUTE_UNSUPPORTED");}
    }
    Walk(child,transform*br.BlockTransform,stack,depth+1);continue;
   }
   var definition=e as AttributeDefinition;if(definition!=null&&!definition.Constant)continue;
   Entity n=null;var l=e as Line;var c=e as Circle;var t=e as DBText;var p=e as Polyline;var p2=e as Polyline2d;var a=e as Arc;var lead=e as Leader;
   if(l!=null)n=new Line(l.StartPoint,l.EndPoint);
   else if(c!=null)n=new Circle(c.Center,c.Normal,c.Radius);
   else if(a!=null)n=new Arc(a.Center,a.Normal,a.Radius,a.StartAngle,a.EndAngle);
   else if(t!=null){var q=new DBText();q.Position=t.Position;q.TextString=t.TextString;q.Height=t.Height;q.Rotation=t.Rotation;n=q;}
   else if(p!=null){var q=new Polyline();for(int i=0;i<p.NumberOfVertices;i++)q.AddVertexAt(i,p.GetPoint2dAt(i),p.GetBulgeAt(i),p.GetStartWidthAt(i),p.GetEndWidthAt(i));q.Closed=p.Closed;q.Elevation=p.Elevation;n=q;}
   else if(p2!=null){var q=new Polyline();int j=0;foreach(ObjectId vid in p2){var v=st.GetObject(vid,OpenMode.ForRead) as Vertex2d;if(v==null){Skip("POLYLINE2D_VERTEX_UNSUPPORTED");continue;}q.AddVertexAt(j++,new Point2d(v.Position.X,v.Position.Y),v.Bulge,v.StartWidth,v.EndWidth);}q.Closed=p2.Closed;n=q;}
   else if(lead!=null){var q=new Polyline();for(int j=0;j<lead.NumVertices;j++){var pt=lead.VertexAt(j);q.AddVertexAt(j,new Point2d(pt.X,pt.Y),0,0,0);}n=q;Skip("LEADER_ARROWHEAD_UNSUPPORTED");}
   if(n==null){Skip(e.GetType().Name);continue;}
   try{n.TransformBy(transform);dest.AppendEntity(n);dt.AddNewlyCreatedDBObject(n,true);copied++;}catch(System.Exception){n.Dispose();Skip("TRANSFORM_UNSUPPORTED:"+e.GetType().Name);}
  }catch(System.Exception){Skip("ENTITY_READ_FAILED");}}
  stack.Remove(b.ObjectId);
 }
 [CommandMethod("R05PLOT")]
 public void Run(){
  var output=Environment.GetEnvironmentVariable("CAD_PROBE_OUTPUT");var log=output+".txt";var old=HostApplicationServices.Current;
  try{
   var doc=Application.DocumentManager.MdiActiveDocument;var dest=doc.Database;
   using(var source=new Database(false,true)){
    HostApplicationServices.Current=new DenyFiles();
    try{source.ReadDwgFile(Environment.GetEnvironmentVariable("CAD_PROBE_INPUT"),FileOpenMode.OpenForReadAndAllShare,true,"");
     using(st=source.TransactionManager.StartOpenCloseTransaction())using(dt=dest.TransactionManager.StartTransaction()){
      var sb=(BlockTable)st.GetObject(source.BlockTableId,OpenMode.ForRead);var sm=(BlockTableRecord)st.GetObject(sb[BlockTableRecord.ModelSpace],OpenMode.ForRead);
      var db=(BlockTable)dt.GetObject(dest.BlockTableId,OpenMode.ForRead);this.dest=(BlockTableRecord)dt.GetObject(db[BlockTableRecord.ModelSpace],OpenMode.ForWrite);
      Walk(sm,Matrix3d.Identity,new System.Collections.Generic.HashSet<ObjectId>(),0);dt.Commit();
     }
    }finally{HostApplicationServices.Current=old;}
   }
   HostApplicationServices.WorkingDatabase=dest;LayoutManager.Current.CurrentLayout="Model";doc.Editor.Regen();File.WriteAllText(log,"layout="+LayoutManager.Current.CurrentLayout+" tile="+Application.GetSystemVariable("TILEMODE")+" working="+(HostApplicationServices.WorkingDatabase==dest));
   using(var tr=dest.TransactionManager.StartTransaction()){
    var layout=(Layout)tr.GetObject(LayoutManager.Current.GetLayoutId("Model"),OpenMode.ForRead);
    using(var ps=new PlotSettings(layout.ModelType)){
     ps.CopyFrom(layout);var v=PlotSettingsValidator.Current;v.SetPlotConfigurationName(ps,"DWG To PDF.pc3",null);v.RefreshLists(ps);
     v.SetPlotType(ps,Autodesk.AutoCAD.DatabaseServices.PlotType.Extents);v.SetUseStandardScale(ps,true);v.SetStdScaleType(ps,StdScaleType.ScaleToFit);v.SetPlotCentered(ps,true);
     using(var info=new PlotInfo()){info.Layout=layout.ObjectId;info.OverrideSettings=ps;var validator=new PlotInfoValidator();validator.MediaMatchingPolicy=MatchingPolicy.MatchEnabled;validator.Validate(info);
      using(var engine=PlotFactory.CreatePublishEngine()){engine.BeginPlot(null,null);engine.BeginDocument(info,"R05 synthetic",null,1,true,output);
       using(var page=new PlotPageInfo()){engine.BeginPage(page,info,true,null);engine.BeginGenerateGraphics(null);engine.EndGenerateGraphics(null);engine.EndPage(null);}
       engine.EndDocument(null);engine.EndPlot(null);
      }
     }
    }
    tr.Commit();
   }
   File.WriteAllText(log,"copied="+copied+" skipped="+skipped+" omitted="+String.Join(",",System.Linq.Enumerable.Select(omitted,x=>x.Key+":"+x.Value).ToArray())+" success");
  }catch(System.Exception ex){HostApplicationServices.Current=old;File.AppendAllText(log," copied="+copied+" skipped="+skipped+" ERROR "+ex);}
 }
}
