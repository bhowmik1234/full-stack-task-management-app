import { ReactElement, useEffect, useState } from "react";
import TableHOC from "../components/admin/TableHOC";
import { Column } from "react-table";
import { Link } from "react-router-dom";
import { useSelector } from "react-redux";
import { userReducerIntialState } from "../types/reducer-types";
import { useMyOrdersQuery } from "../redux/api/orderAPI";
import toast from "react-hot-toast";
import { CustomError } from "../types/api-types";
import { Skeleton } from "../components/Loader";

type DataType = {
  _id: string;
  amount: number;
  quantity: number;
  discount: number;
  status: ReactElement;
  action: ReactElement;
};

const column: Column<DataType>[] = [
  {
    Header: "ID",
    accessor: "_id",
  },
  {
    Header: "Quantity",
    accessor: "quantity",
  },
  {
    Header: "Discount",
    accessor: "discount",
  },
  {
    Header: "Amount",
    accessor: "amount",
  },
  {
    Header: "Status",
    accessor: "status",
  },
  {
    Header: "Action",
    accessor: "action",
  },
];

const Orders = () => {

  const { user } = useSelector((state:{userReducer: userReducerIntialState})=> state.userReducer);
  
  const { isLoading, data, isError, error} = useMyOrdersQuery(user?._id!);

  const [rows, setRows] = useState<DataType[]>([]);
  if(isError){
    const err = error as CustomError;
    toast.error(err.data.message);
  }

  useEffect(()=>{
    if (data)
      setRows(
        data.orders.map((i) => ({
          _id: i._id,
          amount: i.total,
          discount: i.discount,
          quantity: i.orderItems.length,
          status: <span className={i.status==="Processing"?"red": i.status==="Shipped"?"green":"purple"}>{i.status}</span>,
          action: <Link to={`/admin/transaction/${i._id}`}>Manage</Link>
        }))
      );
  }, [data])


  const Table = TableHOC<DataType>(
    column,
    rows,
    "dashboard-product-box",
    "Orders",
    rows.length > 6
  )();
  return (
    <div className="container">
      <div>

        <h1>My Orders</h1>
        <main>{isLoading ? <Skeleton width="50vw" length={25} /> : Table}</main>
      </div>
    </div>
  );
};

export default Orders;